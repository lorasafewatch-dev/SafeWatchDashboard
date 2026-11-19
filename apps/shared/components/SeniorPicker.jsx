import { useId, useRef, useState } from 'react';
import { matchingSeniors, seniorName } from '../seniorSearch.js';
import SeniorPhoto from './SeniorPhoto.jsx';
import './SeniorFeatures.css';

// Every selection is a Watch ID. Names are presentation/search only.
export default function SeniorPicker({ seniors = [], value = '', onChange, label = 'Senior to monitor', disabled = false, allowAll = false }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const root = useRef(null);
  const input = useRef(null);
  const selected = seniors.find(senior => senior.id === value);
  const matches = matchingSeniors(seniors, query);
  const options = [...(allowAll && !query.trim() ? [{ id: '', name: 'All seniors' }] : []), ...matches];
  const choose = senior => { onChange?.(senior.id); setOpen(false); setQuery(''); input.current?.focus(); };
  return <div className="senior-picker" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setQuery(''); } }}>
    <label htmlFor={id}>{label}</label>
    <div className="senior-picker__input"><input ref={input} id={id} role="combobox" autoComplete="off" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-list`} aria-activedescendant={open && options[active] ? `${id}-option-${active}` : undefined}
      disabled={disabled || !onChange} placeholder={selected ? seniorName(selected) : allowAll ? 'All seniors' : 'Search senior name…'} value={open ? query : selected ? seniorName(selected) : allowAll ? 'All seniors' : ''}
      onFocus={() => { setOpen(true); setQuery(''); setActive(0); }} onClick={() => setOpen(true)}
      onChange={event => { setQuery(event.target.value); setActive(0); setOpen(true); }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); setQuery(''); }
        if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
          event.preventDefault(); setOpen(true);
          const next = !open ? 0 : Math.max(0, Math.min(options.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1)));
          setActive(next); root.current?.querySelector(`[data-option-index="${next}"]`)?.scrollIntoView({ block: 'nearest' });
        }
        if (event.key === 'Enter' && open) { event.preventDefault(); if (options[active]) choose(options[active]); }
      }}/><button type="button" tabIndex={-1} disabled={disabled || !onChange} aria-label={`Open ${label.toLowerCase()}`} onPointerDown={event => event.preventDefault()} onClick={() => { setOpen(value => !value); input.current?.focus(); }}>⌄</button></div>
    {open && <ul className="senior-picker__options" id={`${id}-list`} role="listbox" aria-label={label}>
      {options.map((senior, index) => <li id={`${id}-option-${index}`} data-option-index={index} key={senior.id || 'all'} role="option" aria-selected={senior.id === value} className={index === active ? 'is-highlighted' : ''}
        onPointerDown={event => event.preventDefault()} onClick={() => choose(senior)}>
        {senior.id && <SeniorPhoto senior={senior}/>}<span><strong>{seniorName(senior)}</strong>{senior.id && <small>Watch ID: {senior.id}</small>}</span>
      </li>)}
      {!options.length && <li role="presentation" className="senior-picker__empty"><span role="status">No matching seniors</span></li>}
    </ul>}
  </div>;
}
