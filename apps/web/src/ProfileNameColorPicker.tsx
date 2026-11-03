import { useEffect, useState } from 'react';
import './ProfileNameColorPicker.css';

const HEX_COLOR = /^#[0-9A-F]{6}$/i;

export function isHexNameColor(value: string) { return HEX_COLOR.test(value); }

export function ProfileNameColorPicker({ value, onChange, onValidityChange, label = 'Cor do nome', defaultValue = 'DEFAULT', resetLabel = 'Usar cor padrão' }: { value: string; onChange: (value: string) => void; onValidityChange?: (valid: boolean) => void; label?: string; defaultValue?: string; resetLabel?: string }) {
  const [manualValue, setManualValue] = useState(value === defaultValue ? '#246B6E' : value);
  const [valid, setValid] = useState(true);
  const isDefault = value === defaultValue;
  useEffect(() => {
    if (isDefault) setManualValue('#246B6E');
    else if (HEX_COLOR.test(value)) setManualValue(value.toUpperCase());
  }, [value, isDefault]);
  function updateValidity(next: boolean) { setValid(next); onValidityChange?.(next); }
  function update(raw: string) {
    setManualValue(raw);
    const normalized = raw.startsWith('#') ? raw : `#${raw}`;
    if (HEX_COLOR.test(normalized)) { updateValidity(true); onChange(normalized.toUpperCase()); }
    else updateValidity(false);
  }
  const activeColor = !isDefault && HEX_COLOR.test(value) ? value : manualValue;
  return <fieldset className="profile-name-color-picker">
    <legend>{label}</legend>
    <div className="profile-name-color-picker-row">
      <label className="profile-name-color-swatch" title={`Escolher ${label.toLowerCase()}`}>
        <span style={{ backgroundColor: activeColor }}/>
        <input type="color" aria-label={`Escolher ${label.toLowerCase()}`} value={activeColor} onChange={(event) => update(event.target.value)}/>
      </label>
      <label className="profile-name-color-hex"><span className="sr-only">Valor HEX</span><input value={isDefault ? '' : manualValue} placeholder="Padrão" maxLength={7} spellCheck={false} inputMode="text" aria-invalid={!valid} onChange={(event) => update(event.target.value)}/></label>
    </div>
    {!valid && <small className="profile-name-color-error">Informe uma cor HEX válida, como #8D86C9.</small>}
    <button className="profile-name-color-reset" type="button" onClick={() => { updateValidity(true); onChange(defaultValue); }}>{resetLabel}</button>
  </fieldset>;
}
