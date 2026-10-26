import React, { useEffect, useState } from 'react';
import { TextField } from '@shopify/polaris';

// A number input that keeps what the user is typing ("2." / "" / "-") instead of snapping to the parsed
// value on every keystroke; the parent only hears about complete, valid numbers.
export default function NumberField({ label, value, onChange, min, max, step, suffix, helpText, disabled }) {
  const [text, setText] = useState(String(value ?? ''));
  useEffect(() => {
    if (Number(text) !== value) setText(String(value ?? ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <TextField
      label={label} type="number" autoComplete="off" value={text} suffix={suffix} helpText={helpText} disabled={disabled}
      min={min} max={max} step={step}
      onChange={(v) => {
        setText(v);
        const n = Number(v);
        if (v.trim() !== '' && Number.isFinite(n) && (min == null || n >= min) && (max == null || n <= max)) onChange(n);
      }}
      onBlur={() => setText(String(value ?? ''))}
    />
  );
}
