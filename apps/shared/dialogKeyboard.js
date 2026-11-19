export function dialogKeyboard(event, onClose) {
  if (event.key === 'Escape') { event.stopPropagation(); onClose?.(); }
  if (event.key !== 'Tab') return;
  const controls = [...event.currentTarget.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),[tabindex="0"]')];
  const first = controls[0], last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}
