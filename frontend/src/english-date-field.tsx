import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' });
const fullDate = new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeZone: 'UTC' });
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const datePattern = /^(\d{4}-\d{2}-\d{2})$/;
const dateTimePattern = /^(\d{4}-\d{2}-\d{2})[ T](?:[01]\d|2[0-3]):[0-5]\d$/;

function utcDate(year: number, month: number, day = 1) {
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  return date;
}

function calendarDate(value: string) {
  if (!datePattern.test(value) || value.startsWith('0000')) return null;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

export function EnglishDateField({ label, name, defaultValue = '', value, onValueChange, required = false, withTime = false }: {
  label: string; name?: string; defaultValue?: string; value?: string; onValueChange?: (value: string) => void;
  required?: boolean; withTime?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return utcDate(now.getFullYear(), now.getMonth());
  });
  const format = withTime ? 'YYYY-MM-DD HH:MM' : 'YYYY-MM-DD';

  function validate(field: HTMLInputElement) {
    const raw = field.value;
    const match = (withTime ? dateTimePattern : datePattern).exec(raw);
    field.setCustomValidity(raw === '' ? (required ? 'Enter a date.' : '')
      : match && calendarDate(match[1]) ? '' : `Enter a valid date using ${format}.`);
  }

  useEffect(() => {
    const field = input.current;
    if (!field) return;
    const reset = () => requestAnimationFrame(() => validate(field));
    field.form?.addEventListener('reset', reset);
    return () => field.form?.removeEventListener('reset', reset);
  }, [required, withTime]);
  useEffect(() => {
    if (input.current) validate(input.current);
  }, [value, defaultValue, required, withTime]);

  function openCalendar() {
    const now = new Date();
    const selected = calendarDate(input.current?.value.slice(0, 10) ?? '');
    setMonth(selected ? utcDate(selected.getUTCFullYear(), selected.getUTCMonth()) : utcDate(now.getFullYear(), now.getMonth()));
  }

  function choose(date: Date) {
    const field = input.current;
    if (!field) return;
    const time = dateTimePattern.test(field.value) ? field.value.slice(10).trimStart().replace(/^T/, '') : '';
    field.value = date.toISOString().slice(0, 10) + (withTime ? ' ' + time : '');
    validate(field);
    onValueChange?.(field.value);
    popup.current?.hidePopover();
    field.focus();
    if (withTime && !time) field.setSelectionRange(field.value.length, field.value.length);
  }

  const year = month.getUTCFullYear();
  const monthIndex = month.getUTCMonth();
  const offset = month.getUTCDay();
  const days = utcDate(year, monthIndex + 1, 0).getUTCDate();
  const setYear = (field: HTMLInputElement) => {
    const next = Number(field.value);
    if (Number.isInteger(next) && next >= 1 && next <= 9999) setMonth(utcDate(next, monthIndex));
    else field.value = String(year);
  };
  return <div className="form-field english-date-field">
    <label htmlFor={id}>{label}</label>
    <div className="date-field-controls">
      <input ref={input} id={id} name={name} type="text" required={required} lang="en-US"
        autoComplete="off" spellCheck={false} placeholder={format} maxLength={withTime ? 16 : 10}
        {...(value === undefined ? { defaultValue: defaultValue.replace('T', ' ') } : { value })}
        onChange={(event) => { validate(event.currentTarget); onValueChange?.(event.currentTarget.value); }} />
      <button className="icon-button date-picker-toggle" type="button" aria-label={`Choose date for ${label}`}
        popoverTarget={id + '-calendar'} onClick={openCalendar}><CalendarDays size={16} aria-hidden="true" /></button>
    </div>
    <div className="date-picker" id={id + '-calendar'} ref={popup} popover="auto" role="dialog" aria-label={`Calendar for ${label}`} lang="en-US">
      <div className="date-picker-navigation">
        <button className="icon-button" type="button" aria-label="Previous month" disabled={year === 1 && monthIndex === 0}
          onClick={() => setMonth(utcDate(year, monthIndex - 1))}><ChevronLeft size={16} aria-hidden="true" /></button>
        <select aria-label="Month" value={monthIndex} onChange={(event) => setMonth(utcDate(year, Number(event.currentTarget.value)))}>
          {Array.from({ length: 12 }, (_, index) => <option key={index} value={index}>{monthName.format(utcDate(2026, index))}</option>)}
        </select>
        <input key={year} aria-label="Year" inputMode="numeric" maxLength={4} defaultValue={year}
          onBlur={(event) => setYear(event.currentTarget)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); setYear(event.currentTarget); } }} />
        <button className="icon-button" type="button" aria-label="Next month" disabled={year === 9999 && monthIndex === 11}
          onClick={() => setMonth(utcDate(year, monthIndex + 1))}><ChevronRight size={16} aria-hidden="true" /></button>
      </div>
      <div className="date-picker-days">
        {weekdays.map((day) => <span key={day} aria-hidden="true">{day}</span>)}
        {Array.from({ length: offset }, (_, index) => <span key={`empty-${index}`} aria-hidden="true" />)}
        {Array.from({ length: days }, (_, index) => {
          const date = utcDate(year, monthIndex, index + 1);
          return <button className="icon-button" type="button" key={index} aria-label={fullDate.format(date)}
            aria-pressed={input.current?.value.slice(0, 10) === date.toISOString().slice(0, 10)} onClick={() => choose(date)}>{index + 1}</button>;
        })}
      </div>
    </div>
  </div>;
}
