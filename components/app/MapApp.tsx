'use client';

// Главный экран «Карта»: шапка, интро, тулбар, левая панель (гид / карточка / форма заказа), карта, список, фильтры.
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { css } from '@/lib/css';
import {
  dateLabel, emptyJobForm, jobAllErrors, jobNum, jobStepErrors, localISO, money, moneyShort,
  type JobDetail, type JobForm, type JobSummary
} from '@/lib/jobs';
import { showModeration } from '@/components/ModerationGuard';
import { useFlash } from '@/components/Toast';
import { useNarrow } from '@/components/useNarrow';
import { SeasonMap, type SeasonMapHandle } from '@/components/map/SeasonMap';
import type { LatLng, Pin } from '@/components/map/mapView';
import { ActiveFilterTags, EMPTY_FILTERS, FiltersPanel, filtersCount, type Filters, type JobTypeRow } from './FiltersPanel';
import { applyState, JobDetailPanel } from './JobDetailPanel';
import { JobFormPanel } from './JobFormPanel';
import { JobListOverlay } from './JobListOverlay';
import { useLive, useLiveEvent } from './Live';
import { NAV_H } from './MobileShell';
import { ObjectCardPanel, ObjectsList, type ObjectCard } from './ObjectsBlock';
import { GuestGuide, StartSteps } from './RailSummary';
import { Corners, LABEL } from './ui';

export type { Me } from './Live';
import type { Me } from './Live';

const WORK_BTN = 'flex: 1; min-height: 58px; font-size: 19px; letter-spacing: .02em; border: 1px solid var(--color-accent-900); cursor: pointer; font-family: var(--font-heading); display: flex; align-items: center; justify-content: center; text-align: center; padding: 0 10px'

type GeoHit = { lat: number; lng: number; label: string; sub: string; district: string };
type Kept = { form: JobForm; step: number };

const FILTERS_KEY = 'arena.filters';
const DRAFT_KEY = 'arena.jobDraft';

const readLS = <T,>(k: string): T | null => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : null; } catch { return null; } };
const writeLS = (k: string, v: unknown) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим */ } };

const formHasContent = (f: JobForm) => !!(f.address.trim() || f.desc.trim() || f.pay || f.typeOther.trim() || f.type || f.access.length);

function qs(f: Filters, base: LatLng | null) {
  const p = new URLSearchParams({ today: localISO() });
  if (f.types.length) p.set('types', f.types.join(','));
  if (f.minPay) p.set('minPay', String(f.minPay));
  if (f.km) p.set('km', String(f.km));
  if (f.when === 'soon') p.set('when', 'soon');
  if (f.q.trim()) p.set('q', f.q.trim());
  if (base) { p.set('lat', String(base.lat)); p.set('lng', String(base.lng)); }
  return p.toString();
}

export function MapApp({ me, initialJob, autoApply }: { me: Me; initialJob: number | null; autoApply: boolean }) {
  const flash = useFlash();
  const narrow = useNarrow();
  const mapRef = useRef<SeasonMapHandle>(null);
  const role = me?.role ?? null;
  const isEmp = role === 'employer';

  // ─── Заказы и фильтры ───
  const [filters, setFiltersState] = useState<Filters>(EMPTY_FILTERS);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [base, setBase] = useState<{ lat: number; lng: number; label: string } | null>(me?.baseLat != null ? { lat: me.baseLat, lng: me.baseLng!, label: me.baseLabel } : null);
  const [types, setTypes] = useState<JobTypeRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [offline, setOffline] = useState(false);
  // Черновик заказа, сохранённый при закрытии формы («Продолжить / Удалить»).
  const [kept, setKept] = useState<Kept | null>(null);

  const setFilters = useCallback((f: Filters) => {
    setFiltersState(f);
    writeLS(FILTERS_KEY, { ...f, q: '' });
  }, []);

  useEffect(() => {
    const saved = readLS<Filters>(FILTERS_KEY);
    if (saved) setFiltersState({ ...EMPTY_FILTERS, ...saved, q: '' });
    setKept(readLS<Kept>(DRAFT_KEY));
    const on = () => setOffline(false), off = () => setOffline(true);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    if (navigator.onLine === false) setOffline(true);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // Ответы могут прийти не по порядку (быстрый ввод в поиске) — применяем только последний запрос.
  const loadSeq = useRef(0);
  const loadJobs = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const r = await api<{ jobs: JobSummary[]; base: { lat: number; lng: number; label: string } }>('/api/jobs?' + qs(filters, null));
      if (seq !== loadSeq.current) return;
      setJobs(r.jobs);
      setBase(r.base);
      setLoaded(true);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      if (e instanceof ApiError && e.body.moderation) { showModeration('Поиск', e.body.moderation.category, filters.q); setFiltersState(f => ({ ...f, q: '' })); return; }
      flash(e instanceof ApiError ? e.message : 'Не удалось загрузить заказы');
    }
  }, [filters, flash]);

  useEffect(() => {
    const t = setTimeout(loadJobs, filters.q ? 300 : 0);
    return () => clearTimeout(t);
  }, [loadJobs, filters.q]);

  const loadTypes = useCallback(() => {
    api<{ types: JobTypeRow[] }>('/api/job-types?today=' + localISO()).then(r => setTypes(r.types)).catch(() => {});
  }, []);
  useEffect(loadTypes, [loadTypes]);

  // ─── Выбранный заказ ───
  const [selected, setSelected] = useState<number | null>(initialJob);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [stackPick, setStackPick] = useState<number[] | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    const cur = url.searchParams.get('job');
    if (String(selected ?? '') === (cur ?? '')) return;
    if (selected) url.searchParams.set('job', String(selected)); else url.searchParams.delete('job');
    url.searchParams.delete('apply');
    window.history.replaceState(null, '', url);
  }, [selected]);

  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    let alive = true;
    api<{ job: JobDetail }>('/api/jobs/' + selected)
      .then(r => { if (alive) setDetail(r.job); })
      .catch(e => { if (!alive) return; flash(e instanceof ApiError ? e.message : 'Не удалось открыть заказ'); setSelected(null); });
    return () => { alive = false; };
  }, [selected, flash]);

  // Карта доезжает до метки с первого клика по карточке.
  const flownFor = useRef<number | null>(null);
  useEffect(() => {
    if (detail && flownFor.current !== detail.num) {
      flownFor.current = detail.num;
      setTimeout(() => mapRef.current?.flyTo(detail.lat, detail.lng, 11), 60);
    }
  }, [detail]);

  const patchJob = (j: JobDetail) => {
    setDetail(j);
    setJobs(list => list.map(x => (x.num === j.num ? { ...x, myStatus: j.myStatus, applicants: j.applicants, hired: j.hired, status: j.status, date: j.date, urgent: j.urgent } : x)));
  };

  const apply = useCallback(async (reqConfirmed: boolean) => {
    if (!detail) return;
    setBusy(true);
    try {
      const r = await api<{ job: JobDetail }>('/api/jobs/' + detail.num + '/apply', { reqConfirmed, today: localISO() });
      patchJob(r.job);
      flash('Отклик отправлен работодателю');
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Отклик не отправился — попробуйте ещё раз');
    } finally { setBusy(false); }
  }, [detail, flash]);

  // Отложенный отклик после регистрации/входа: условие работодателя автооткликом не обходим.
  // Параметр apply=1 убираем сразу — перезагрузка страницы не должна повторять отклик.
  const autoDone = useRef(false);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('apply')) { url.searchParams.delete('apply'); window.history.replaceState(null, '', url); }
  }, []);
  useEffect(() => {
    if (!autoApply || autoDone.current || !detail || role !== 'freelancer') return;
    autoDone.current = true;
    if (detail.myStatus === 'sent' || detail.myStatus === 'hired') return;
    if (detail.requirement) { flash('Осталось подтвердить условия заказа — отметьте их в карточке'); return; }
    apply(false);
  }, [autoApply, detail, role, apply, flash]);

  const withdraw = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      patchJob((await api<{ job: JobDetail }>('/api/jobs/' + detail.num + '/withdraw', {})).job);
      flash('Отклик отозван — без пометки в профиле');
    } catch (e) { flash(e instanceof ApiError ? e.message : 'Не получилось — попробуйте ещё раз'); } finally { setBusy(false); }
  };

  const cancelJob = async (reason: string, notice: string) => {
    if (!detail) return;
    setBusy(true);
    try {
      setDetail((await api<{ job: JobDetail }>('/api/jobs/' + detail.num + '/cancel', { reason, notice })).job);
      flash('Смена отменена — исполнители уведомлены');
      loadJobs();
    } catch (e) { flash(e instanceof ApiError ? e.message : 'Не получилось — попробуйте ещё раз'); } finally { setBusy(false); }
  };

  // ─── Форма заказа (работодатель) ───
  const [form, setFormState] = useState<JobForm | null>(null);
  const [formStep, setFormStep] = useState(1);
  const [formErrs, setFormErrs] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [addrNote, setAddrNote] = useState('');
  const addrSynced = useRef('');
  const [addrQuery, setAddrQuery] = useState('');
  const [addrBusy, setAddrBusy] = useState(false);
  const [addrError, setAddrError] = useState('');
  const [addrManual, setAddrManual] = useState(false);

  const setForm = useCallback((patch: Partial<JobForm>, clearErr?: string) => {
    setFormState(f => (f ? { ...f, ...patch } : f));
    if (clearErr) setFormErrs(e => ({ ...e, [clearErr]: '' }));
    setFormError('');
  }, []);

  const closeForm = useCallback((keep: boolean) => {
    if (form && keep && !editing && formHasContent(form)) {
      const k = { form, step: formStep };
      writeLS(DRAFT_KEY, k);
      setKept(k);
    }
    setFormState(null);
    // Закрыли правку без сохранения — возвращаем карточку заказа.
    if (editing) setSelected(editing);
    setEditing(null);
    setFormErrs({});
    setFormError('');
    setAddrNote('');
  }, [form, editing, formStep]);

  const reverse = useCallback(async (p: LatLng) => {
    setAddrNote('Определяем адрес точки…');
    try {
      const r = await api<{ hit: GeoHit | null }>('/api/geo/reverse?lat=' + p.lat + '&lng=' + p.lng);
      if (!r.hit) { setAddrNote('Адрес точки не определён — впишите его вручную.'); return; }
      addrSynced.current = r.hit.label;
      setFormState(f => (f && f.lat === p.lat && f.lng === p.lng ? { ...f, address: f.address.trim() ? f.address : r.hit!.label, district: r.hit!.district || f.district } : f));
      setFormErrs(e => ({ ...e, address: '' }));
      setAddrNote('Метка на карте: ' + r.hit.label);
    } catch {
      setAddrNote('Адрес точки не определён — впишите его вручную.');
    }
  }, []);

  /** Метка работодателя: клик по карте или найденный адрес. При открытой форме — только переставляем метку. */
  const placeAt = useCallback((p: LatLng, hit?: GeoHit) => {
    if (!isEmp) return;
    setSelected(null);
    setStackPick(null);
    setFormState(f => {
      if (f) return { ...f, lat: p.lat, lng: p.lng, ...(hit ? { address: hit.label, district: hit.district || f.district } : {}) };
      const nf = emptyJobForm();
      return { ...nf, lat: p.lat, lng: p.lng, address: hit?.label || '', district: hit?.district || '' };
    });
    setFormErrs(e => ({ ...e, address: '' }));
    if (!form) { setFormStep(1); setFormError(''); setEditing(null); }
    if (hit) { addrSynced.current = hit.label; setAddrNote('Метка на карте: ' + hit.label); }
  }, [isEmp, form]);

  // ─── Мои объекты (работодатель) ───
  const [objects, setObjects] = useState<ObjectCard[]>([]);
  const [objEdit, setObjEdit] = useState<ObjectCard | null>(null);
  const formOpen = !!form;
  useEffect(() => {
    if (!isEmp || formOpen) return;
    api<{ objects: ObjectCard[] }>('/api/me/objects').then(r => setObjects(r.objects)).catch(() => {});
  }, [isEmp, formOpen]);

  /** Заказ с объекта: метка, адрес, объём, доступ, инвентарь и встречающий — из карточки. */
  const fromObject = (o: ObjectCard) => {
    setObjEdit(null);
    placeAt({ lat: o.lat, lng: o.lng }, { lat: o.lat, lng: o.lng, label: o.address, sub: '', district: '' });
    setFormState(f => (f ? {
      ...f, objectId: o.id, volume: o.area, access: o.access.slice(), tools: o.tools, meetName: o.contact,
      desc: f.desc || 'Объект «' + o.name + '»' + (o.area ? ', ' + o.area : '') + '.' + (o.contact ? ' На месте: ' + o.contact + '.' : '')
    } : f));
    mapRef.current?.flyTo(o.lat, o.lng, 14);
  };

  const saveAsObject = async () => {
    if (!form || form.lat == null) return;
    try {
      const r = await api<{ object: ObjectCard }>('/api/me/objects', {
        name: form.address.split(',').slice(-2).join(',').trim().slice(0, 80) || form.address.slice(0, 80), address: form.address, lat: form.lat, lng: form.lng,
        area: form.volume, contact: form.meetName, access: form.access, tools: form.tools
      });
      setForm({ objectId: r.object.id });
      setObjects(list => [r.object, ...list]);
      flash('Объект «' + r.object.name + '» сохранён — название можно поменять в карточке');
    } catch (e) {
      if (e instanceof ApiError && e.body.moderation) showModeration(e.body.moderation.label, e.body.moderation.category);
      else flash(e instanceof ApiError ? e.message : 'Не удалось сохранить объект');
    }
  };

  const onMapClick = useCallback((p: LatLng) => {
    if (!isEmp) return;
    // Геокодер не нашёл адрес — адресом станет то, что ввёл человек.
    if (addrManual && addrQuery.trim() && !form) {
      placeAt(p, { lat: p.lat, lng: p.lng, label: addrQuery.trim(), sub: '', district: '' });
      setAddrManual(false); setAddrError('');
      flash('Метка поставлена вручную');
      return;
    }
    const hadAddress = !!form?.address.trim();
    placeAt(p);
    if (!hadAddress) reverse(p);
    else setAddrNote('Метка переставлена — адрес оставили как вписали.');
  }, [isEmp, addrManual, addrQuery, form, placeAt, reverse, flash]);

  const geocode = async (q: string): Promise<GeoHit | null> => {
    const r = await api<{ hits: GeoHit[] }>('/api/geo/search?q=' + encodeURIComponent(q));
    return r.hits[0] || null;
  };

  // Адрес в форме ведёт метку: ушли из поля — карта переезжает на найденную точку.
  const syncAddrToMap = async () => {
    const q = form?.address.trim() || '';
    if (!q || q === addrSynced.current) return;
    addrSynced.current = q;
    setAddrNote('Ищем адрес на карте…');
    try {
      const hit = await geocode(q);
      if (!hit) { setAddrNote('Адрес не найден. Оставьте как вписали или поставьте метку кликом по карте.'); return; }
      setFormState(f => (f ? { ...f, lat: hit.lat, lng: hit.lng, district: hit.district || f.district } : f));
      setFormErrs(e => ({ ...e, address: '' }));
      setAddrNote('Метка на карте: ' + hit.label);
      mapRef.current?.flyTo(hit.lat, hit.lng, 14);
    } catch (e) {
      setAddrNote((e instanceof ApiError ? e.message : 'Геокодер недоступен.') + ' Адрес можно оставить как вписали — метку поставьте кликом по карте.');
    }
  };

  const findAddress = async () => {
    const q = addrQuery.trim();
    if (!q || addrBusy) return;
    setAddrBusy(true); setAddrError('');
    try {
      const hit = await geocode(q);
      if (!hit) { setAddrManual(true); setAddrError('Адрес не найден. Поставьте метку кликом по карте — адресом станет то, что вы ввели.'); return; }
      setAddrManual(false);
      placeAt({ lat: hit.lat, lng: hit.lng }, hit);
      mapRef.current?.flyTo(hit.lat, hit.lng, 14);
      flash('Адрес найден — заполните данные заказа');
    } catch {
      setAddrManual(true);
      setAddrError('Геокодер недоступен — поставьте метку кликом по карте.');
    } finally { setAddrBusy(false); }
  };

  const goStep = (n: number) => {
    if (!form) return;
    if (n <= formStep) { setFormStep(n); setFormError(''); return; }
    for (let s = formStep; s < n; s++) {
      const errs = jobStepErrors(s, form);
      if (Object.keys(errs).length) { setFormStep(s); setFormErrs(errs); setFormError('Сначала закончите шаг 0' + s + '.'); return; }
    }
    setFormStep(n); setFormErrs({}); setFormError('');
  };

  const publish = async () => {
    if (!form) return;
    const errs = jobAllErrors(form);
    const keys = Object.keys(errs);
    if (keys.length) {
      const stepOf: Record<string, number> = { address: 1, desc: 2, type: 2, crew: 2, pay: 3, date: 3, repeat: 3, access: 4, tools: 4 };
      const first = Math.min(...keys.map(k => stepOf[k] || 4));
      setFormErrs(errs); setFormStep(first);
      setFormError(first < 4 ? 'Не заполнено полей: ' + keys.length + '. Вернули на шаг 0' + first + ' — незаполненные подсвечены.' : 'Заполните подсвеченные поля — без них заказ не уйдёт на карту.');
      return;
    }
    setBusy(true);
    try {
      const body = { job: form, today: localISO() };
      const r = editing
        ? await api<{ job: JobDetail }>('/api/jobs/' + editing, body, 'PATCH')
        : await api<{ job: JobDetail }>('/api/jobs', body);
      finishPublish(r.job, !!editing);
    } catch (e) {
      handleFormError(e);
    } finally { setBusy(false); }
  };

  const finishPublish = (j: JobDetail, wasEdit: boolean) => {
    flash(wasEdit ? 'Изменения сохранены — откликнувшимся ушло уведомление' : 'Заказ опубликован — № ' + jobNum(j.num));
    if (!wasEdit) { writeLS(DRAFT_KEY, null); setKept(null); }
    setFormState(null); setEditing(null); setFormErrs({}); setFormError(''); setFormStep(1); setAddrNote('');
    setSelected(j.num);
    setDetail(j);
    loadJobs();
    loadTypes();
  };

  const handleFormError = (e: unknown) => {
    if (e instanceof ApiError) {
      const b = e.body as ApiError['body'] & { fields?: Record<string, string>; step?: number };
      if (b.moderation) { showModeration(b.moderation.label, b.moderation.category); setFormError(b.message); return; }
      if (b.fields) { setFormErrs(b.fields); if (b.step) setFormStep(b.step); setFormError('Заполните отмеченные поля — и перейдём дальше.'); return; }
      if (b.field) setFormErrs(er => ({ ...er, [b.field!]: b.message }));
      setFormError(b.message);
      return;
    }
    setFormError('Заказ не сохранился — проверьте связь и попробуйте ещё раз.');
  };

  const formNext = async () => {
    if (!form) return;
    if (formStep >= 4) return publish();
    const errs = jobStepErrors(formStep, form);
    if (Object.keys(errs).length) { setFormErrs(errs); setFormError('Заполните отмеченные поля — и перейдём дальше.'); return; }
    setFormStep(s => s + 1); setFormErrs({}); setFormError('');
  };

  const startEdit = () => {
    if (!detail) return;
    const d = detail;
    setFormState({
      lat: d.lat, lng: d.lng, address: d.address, district: d.district || '', type: d.typeId, typeOther: '', desc: d.description,
      volume: d.volume || '', crew: String(d.crew), req: d.requirement || '', pay: d.pay.toLocaleString('ru-RU'), unit: d.unit,
      payType: d.payType || '', dateISO: d.date, urgent: d.urgent, regular: !!d.repeat, repeat: d.repeat || '', repeatNote: d.repeatNote || '',
      access: d.access, tools: d.tools || '', meetName: d.meetName || '', meetPhone: d.meetPhone || '', objectId: ''
    });
    addrSynced.current = d.address;
    setEditing(d.num); setFormStep(1); setFormErrs({}); setFormError(''); setSelected(null);
  };

  const restoreDraft = () => {
    if (!kept) return;
    setFormState(kept.form); setFormStep(kept.step || 1); setEditing(null); setSelected(null);
    addrSynced.current = kept.form.address;
    writeLS(DRAFT_KEY, null); setKept(null);
    if (kept.form.lat != null) mapRef.current?.flyTo(kept.form.lat, kept.form.lng!, 13);
  };

  const select = useCallback((num: number) => {
    if (form) closeForm(true);
    setStackPick(null);
    setSelected(num);
    flownFor.current = null;
  }, [form, closeForm]);

  const goHome = () => {
    if (form) closeForm(true);
    setSelected(null); setListOpen(false); setFiltersOpen(false); setStackPick(null);
  };

  // ─── Оболочка: логотип, место плашки «Сообщения», живые обновления ───
  const live = useLive();
  const { setPlace } = live;
  useEffect(() => { setPlace(form ? 'form' : 'map'); }, [form, setPlace]);
  useEffect(() => () => setPlace('page'), [setPlace]);
  const goHomeRef = useRef(goHome);
  useEffect(() => { goHomeRef.current = goHome; });
  useEffect(() => {
    const h = () => goHomeRef.current();
    window.addEventListener('arena:home', h);
    return () => window.removeEventListener('arena:home', h);
  }, []);
  // Смена базы в настройках — пересчитать расстояния.
  useEffect(() => {
    window.addEventListener('arena:reload', loadJobs);
    return () => window.removeEventListener('arena:reload', loadJobs);
  }, [loadJobs]);

  const refreshDetail = useCallback(async (num: number) => {
    try { patchJob((await api<{ job: JobDetail }>('/api/jobs/' + num)).job); } catch { /* заказ могли удалить */ }
  }, []);
  const listReloadT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useLiveEvent((e) => {
    if (e.t !== 'job') return;
    if (e.num === selected) refreshDetail(e.num);
    clearTimeout(listReloadT.current);
    listReloadT.current = setTimeout(loadJobs, 400);
  });

  /** Действие смены: POST на /api/jobs/N/…, обновить карточку и список, показать итог. */
  const act = useCallback(async (path: string, body: unknown, ok: string, method: 'POST' | 'DELETE' = 'POST') => {
    if (!detail) return false;
    setBusy(true);
    try {
      const r = await api<{ job: JobDetail }>('/api/jobs/' + detail.num + '/' + path, method === 'DELETE' ? null : body ?? {}, method);
      patchJob(r.job);
      if (ok) flash(ok);
      loadJobs();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.body.moderation) showModeration(e.body.moderation.label, e.body.moderation.category);
      flash(e instanceof ApiError ? e.message : 'Не получилось — попробуйте ещё раз');
      return false;
    } finally { setBusy(false); }
  }, [detail, flash, loadJobs]);

  // ─── Метки ───
  const pins: Pin[] = useMemo(() => {
    const list = jobs.map(j => ({
      id: j.num, lat: j.lat, lng: j.lng, urgent: j.urgent, rate: moneyShort(j.pay, j.unit), kind: j.typeLabel,
      active: j.num === selected, title: j.title + ' — ' + j.address
    }));
    if (detail && detail.num === selected && !jobs.some(j => j.num === detail.num)) {
      list.push({ id: detail.num, lat: detail.lat, lng: detail.lng, urgent: detail.urgent, rate: moneyShort(detail.pay, detail.unit), kind: detail.typeLabel, active: true, title: detail.title });
    }
    return list;
  }, [jobs, selected, detail]);

  const draftPoint = useMemo(() => (form && form.lat != null && form.lng != null ? { lat: form.lat, lng: form.lng } : null), [form]);
  const anchor = useMemo(() => (base ? { lat: base.lat, lng: base.lng } : null), [base]);
  const onPinClick = useCallback((n: number) => select(n), [select]);
  const onStackClick = useCallback((ids: number[]) => setStackPick(ids), []);

  // ─── Разметка ───
  const found = jobs.length;
  const nFilters = filtersCount(filters);
  const showDetail = !!detail && !form && detail.num === selected;
  const railStyle = narrow
    ? 'grid-row: 2; grid-column: 1; min-height: 0; border-top: 1px solid var(--color-divider); overflow-y: auto; overflow-x: hidden; padding: 14px 16px ' + (me && live.workMode && detail ? '96px' : '26px') + '; background: var(--color-neutral-100); box-shadow: 0 -6px 18px rgba(31,45,58,.10)'
    : 'grid-row: 1; grid-column: 1; min-height: 0; border-right: 1px solid var(--color-divider); overflow-y: auto; overflow-x: hidden; padding: 20px 22px 26px 20px; background: var(--color-neutral-100)';
  const shellStyle = narrow
    ? 'position: relative; flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: ' + (form ? 'minmax(120px, 24%)' : 'minmax(220px, 46%)') + ' minmax(0, 1fr)'
    : 'position: relative; flex: 1; min-height: 0; display: grid; grid-template-columns: ' + (form ? 'minmax(420px, 620px)' : 'minmax(320px, 420px)') + ' minmax(340px, 1fr); overflow-x: auto';
  const PAD = 'max(clamp(14px, 2vw, 24px), calc((100% - 1440px) / 2))';

  return (
    <div style={css('display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden')}>

      {!me && !(narrow && (form || selected)) && (
        <div style={css('flex: none; display: flex; align-items: baseline; gap: 6px 16px; flex-wrap: wrap; padding: clamp(9px, 1.4vw, 13px) ' + PAD + '; background: var(--color-accent-900); border-bottom: 1px solid var(--color-accent-900)')}>
          <span style={css('font-family: var(--font-heading); font-size: clamp(13px, 1.4vw, 15px); letter-spacing: .2em; text-transform: uppercase; color: #fff; flex: none')}>Сезонные работы на карте</span>
          <span style={css('font-size: clamp(14px, 1.5vw, 16px); line-height: 1.45; min-width: 0; color: rgba(255, 255, 255, .92); text-wrap: pretty')}>Здесь ищут подработку: убрать снег, скосить траву, разгрузить машину. Видно, где работа, когда выходить и сколько заплатят. Резюме не нужно.</span>
        </div>
      )}

      {offline && (
        <div role="status" style={css('flex: none; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 9px 20px; border-top: 1px solid var(--color-accent); border-bottom: 1px solid var(--color-accent); background: color-mix(in srgb, var(--color-accent) 9%, transparent)')}>
          <span style={css('font-family: var(--font-heading); font-size: 12.5px; letter-spacing: .2em; text-transform: uppercase; color: var(--color-accent-900)')}>нет сети</span>
          <span style={css('font-size: 13.5px; line-height: 1.45; min-width: 0; color: var(--color-accent-900)')}>Карта и список показаны из последней загрузки. Отклик и публикация заработают, когда связь вернётся.</span>
          <span style={{ flex: 1 }} />
          <button className="btn btn-ghost" onClick={() => { if (navigator.onLine) { setOffline(false); loadJobs(); } }} style={css('height: 28px; font-size: 12.5px; flex: none')}>Проверить связь</button>
        </div>
      )}

      {!(narrow && form) && (
        <div style={css('flex: none; display: flex; align-items: center; gap: 8px 12px; flex-wrap: wrap; padding: 10px ' + PAD + '; border-bottom: 1px solid var(--color-divider); background: var(--color-neutral-100)')}>
          <button className="btn btn-primary" onClick={() => setListOpen(o => !o)} aria-expanded={listOpen} style={css('height: 34px; font-size: 13px; padding: 0 13px; flex: none; display: inline-flex; align-items: center; gap: 7px')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
            {listOpen ? 'Скрыть список заказов' : 'Все заказы списком · ' + found}
          </button>
          <button className="btn btn-primary" onClick={() => setFiltersOpen(o => !o)} aria-expanded={filtersOpen} style={css('height: 34px; font-size: 13px; padding: 0 13px; flex: none')}>{nFilters ? 'Фильтры · ' + nFilters : 'Фильтры'}</button>
          <span aria-live="polite" style={css('font-family: var(--font-heading); font-size: 13px; letter-spacing: .18em; text-transform: uppercase; color: color-mix(in srgb, var(--color-text) 60%, transparent); white-space: nowrap; flex: none')}>{loaded ? 'найдено ' + found : 'загрузка…'}</span>
          {me && (
            <span className="only-wide" style={css('display: contents')}>
              <button className="btn btn-primary" onClick={() => live.setRail(live.rail === 'journal' ? null : 'journal')} title="Оповещения и журнал" aria-label={'Журнал' + (live.journal ? ', новых: ' + live.journal : '')}
                style={css('position: relative; height: 34px; font-size: 13px; padding: 0 12px; flex: none; display: inline-flex; align-items: center; gap: 7px')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
                Журнал
                {live.journal > 0 && <span style={css('min-width: 17px; height: 17px; box-sizing: border-box; padding: 0 4px; border-radius: 999px; background: var(--color-bg); color: var(--color-accent-900); font-family: var(--font-heading); font-size: 11.5px; line-height: 17px; text-align: center')}>{live.journal > 99 ? '99+' : live.journal}</span>}
              </button>
              <button className="btn btn-primary" onClick={() => live.setRail(live.rail === 'settings' ? null : 'settings')} title="Настройки" aria-label="Настройки"
                style={css('height: 34px; font-size: 13px; padding: 0 12px; flex: none; display: inline-flex; align-items: center; gap: 7px')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
                Настройки
              </button>
            </span>
          )}
          <ActiveFilterTags filters={filters} setFilters={setFilters} types={types} />
        </div>
      )}

      {filtersOpen && <FiltersPanel filters={filters} setFilters={setFilters} types={types} found={found} baseLabel={(base?.label || 'Москва') + (me ? ' · город из профиля' : ' · войдите, чтобы искать от своего города')} onClose={() => setFiltersOpen(false)} />}

      <div style={css(shellStyle)}>
        {listOpen && (
          <JobListOverlay jobs={jobs} q={filters.q} setQ={q => setFiltersState(f => ({ ...f, q }))} role={role}
            onClose={() => setListOpen(false)} onOpen={n => { select(n); setListOpen(false); }} onHover={setHover} />
        )}

        <div style={css(railStyle)}>
          {kept && !form && isEmp && (
            <div style={css('border: 1px solid var(--color-accent); padding: 10px 12px; margin-bottom: 14px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap')}>
              <div style={css('flex: 1 1 180px; min-width: 0')}>
                <div style={css(LABEL)}>Черновик заказа</div>
                <div style={css('font-size: 13.5px; margin-top: 3px')}>{(kept.form.address || 'адрес не указан') + ' · шаг ' + (kept.step || 1) + ' из 4'}</div>
              </div>
              <button className="btn btn-secondary" onClick={restoreDraft} style={css('height: 34px; font-size: 13px')}>Продолжить</button>
              <button className="btn btn-ghost" onClick={() => { writeLS(DRAFT_KEY, null); setKept(null); }} style={css('height: 34px; font-size: 13px')}>Удалить</button>
            </div>
          )}

          {form && isEmp && !editing && !form.objectId && form.lat != null && form.address.trim() && (
            <div style={css('display: flex; justify-content: flex-end; margin-bottom: 6px')}>
              <button className="btn btn-ghost" onClick={saveAsObject} style={css('height: 28px; font-size: 12.5px; padding: 0 8px')}>Сохранить адрес как объект</button>
            </div>
          )}
          {form?.objectId && <div style={css('font-size: 12.5px; margin-bottom: 6px; color: var(--color-accent-700)')}>{'Заказ с объекта «' + (objects.find(o => o.id === form.objectId)?.name || 'объект') + '» — попадёт в историю смен объекта'}</div>}

          {form && (
            <JobFormPanel form={form} setForm={setForm} step={formStep} goStep={goStep} errs={formErrs} formError={formError}
              onNext={formNext} onBack={() => { setFormStep(s => Math.max(1, s - 1)); setFormError(''); }} onClose={() => closeForm(true)}
              types={types} addrNote={addrNote} onAddrBlur={syncAddrToMap} busy={busy} editing={!!editing} narrow={narrow} />
          )}

          {showDetail && (
            <JobDetailPanel key={detail!.num} job={detail!} role={role} others={jobs} busy={busy}
              onClose={() => setSelected(null)} onApply={apply} onWithdraw={withdraw} onCancel={cancelJob} onEdit={startEdit} onOpenJob={select}
              act={act} onChat={thread => live.openChat(detail!.num, thread)}
              onReview={(t) => live.openReview({ ...t, num: detail!.num, title: detail!.title + ' · ' + dateLabel(detail!.date), onSaved: patchJob })} />
          )}

          {!form && selected && !showDetail && <div style={css('font-size: 14px; ' + 'color: color-mix(in srgb, var(--color-text) 66%, transparent)')}>Загружаем заказ…</div>}

          {!form && !selected && objEdit && (
            <ObjectCardPanel key={objEdit.id} object={objEdit} onClose={() => setObjEdit(null)} onOpenJob={n => { setObjEdit(null); select(n); }}
              onSaved={o => { setObjects(list => list.map(x => (x.id === o.id ? o : x))); setObjEdit(null); }}
              onDeleted={id => { setObjects(list => list.filter(x => x.id !== id)); setObjEdit(null); }} />
          )}

          {!form && !selected && !objEdit && (!me ? <GuestGuide /> : (
            <>
              <StartSteps isEmp={isEmp} addr={isEmp ? {
                query: addrQuery, setQuery: v => { setAddrQuery(v); setAddrError(''); setAddrManual(false); }, busy: addrBusy,
                note: addrError || 'Найденный адрес станет черновиком заказа. Можно просто кликнуть по карте.', error: !!addrError, onFind: findAddress
              } : undefined} />
              {isEmp && <ObjectsList objects={objects} onMark={fromObject} onEdit={o => { setObjEdit(o); mapRef.current?.flyTo(o.lat, o.lng, 14); }} />}
            </>
          ))}
        </div>

        <div style={css('position: relative; min-width: 0; min-height: 0; overflow: hidden; ' + (narrow ? 'grid-row: 1; grid-column: 1' : 'grid-row: 1; grid-column: 2'))}>
          <SeasonMap ref={mapRef} pins={pins} draft={draftPoint} mode={isEmp ? 'employer' : 'view'} highlight={hover} anchor={isEmp ? null : anchor}
            radiusKm={isEmp ? 0 : filters.km} onMapClick={onMapClick} onPinClick={onPinClick} onStackClick={onStackClick} />
          {stackPick && stackPick.length > 0 && !form && (
            <div className="blueprint" style={css('position: absolute; left: 50%; bottom: 26px; transform: translateX(-50%); z-index: 6; width: min(420px, calc(100% - 32px)); max-height: calc(100% - 52px); display: flex; flex-direction: column; background: var(--color-bg); padding: 13px 15px 14px; box-shadow: var(--shadow-lg)')}>
              <Corners />
              <div style={css('display: flex; align-items: baseline; justify-content: space-between; gap: 10px; flex: none')}>
                <div style={css('font-family: var(--font-heading); font-size: 12px; letter-spacing: .2em; text-transform: uppercase; color: color-mix(in srgb, var(--color-text) 62%, transparent)')}>Ещё на этом адресе</div>
                <button className="btn btn-ghost" onClick={() => setStackPick(null)} style={css('height: 26px; font-size: 12.5px')}>Закрыть</button>
              </div>
              <div style={css('display: grid; gap: 6px; margin-top: 9px; min-height: 0; overflow: auto')}>
                {stackPick.map(n => jobs.find(j => j.num === n)).filter((j): j is JobSummary => !!j).map(j => (
                  <button key={j.num} onClick={() => select(j.num)} style={css('display: flex; align-items: baseline; justify-content: space-between; gap: 12px; text-align: left; cursor: pointer; background: transparent; border: 1px solid var(--color-divider); padding: 9px 11px; font-family: var(--font-body); color: inherit')}>
                    <span style={css('min-width: 0')}>
                      <span style={css('display: block; font-family: var(--font-heading); font-size: 14.5px; text-transform: uppercase; letter-spacing: .02em')}>{j.title}</span>
                      <span style={css('display: block; font-size: 12.5px; color: color-mix(in srgb, var(--color-text) 64%, transparent)')}>{j.address} · {dateLabel(j.date)}</span>
                    </span>
                    <span style={css('flex: none; font-family: var(--font-heading); font-size: 16px; color: var(--color-accent-900)')}>{money(j.pay, j.unit)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {loaded && !found && !form && (
            <div style={css('position: absolute; left: 50%; top: 16px; transform: translateX(-50%); z-index: 6; max-width: calc(100% - 32px); padding: 9px 14px; background: var(--color-bg); border: 1px solid var(--color-divider); box-shadow: var(--shadow-md); font-size: 13.5px; line-height: 1.4')}>
              {nFilters || filters.q.trim() ? 'Под фильтр ничего не попало — снимите лишние условия.' : isEmp ? 'Заказов пока нет — кликните по карте, чтобы опубликовать первый.' : 'Открытых заказов пока нет — загляните позже.'}
            </div>
          )}
        </div>
      </div>

      {/* Рабочий режим на телефоне: крупная кнопка действия над нижним меню */}
      {me && live.workMode && showDetail && !form && (
        <div className="only-narrow" style={css('position: fixed; left: 0; right: 0; bottom: ' + NAV_H + '; z-index: 70; gap: 8px; padding: 8px 10px; background: var(--color-bg); border-top: 1px solid var(--color-divider)')}>
          {isEmp
            ? <Link href="/apps" style={css(WORK_BTN + '; background: var(--color-accent); color: #fff; text-decoration: none')}>{'Отклики · ' + detail!.applicants}</Link>
            : (() => {
              const st = applyState(detail!, role, false);
              return (
                <button onClick={() => apply(false)} disabled={busy || st.key !== 'open'}
                  style={css(WORK_BTN + '; background: ' + (st.key === 'open' ? 'var(--color-accent)' : 'var(--color-neutral-100)') + '; color: ' + (st.key === 'open' ? '#fff' : 'var(--color-accent-900)'))}>
                  {st.key === 'open' ? 'Взять заказ' : st.key === 'req' ? 'Подтвердите условие в карточке' : st.label}
                </button>
              );
            })()}
          <button onClick={() => setSelected(null)} aria-label="Закрыть заказ" style={css(WORK_BTN + '; flex: 0 0 64px; background: var(--color-neutral-100); color: var(--color-accent-900)')}>×</button>
        </div>
      )}
    </div>
  );
}
