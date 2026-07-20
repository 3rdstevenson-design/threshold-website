import * as React from 'react';

type CheckboxProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: React.ReactNode;
};

export function Checkbox({ label, style, checked, ...rest }: CheckboxProps) {
  return (
    <label
      style={{
        display: 'inline-flex',
        gap: 10,
        alignItems: 'center',
        cursor: 'pointer',
        fontFamily: 'var(--font-body)',
        fontSize: 13,
        color: 'var(--fg-primary)',
        ...style,
      }}
    >
      <span
        style={{
          position: 'relative',
          width: 18,
          height: 18,
          background: checked ? 'var(--threshold-purple)' : 'var(--input-bg)',
          border: `1px solid ${checked ? 'var(--threshold-purple)' : 'var(--input-border)'}`,
          borderRadius: 8,
          display: 'inline-block',
          flex: 'none',
        }}
      >
        {checked && (
          <svg
            viewBox="0 0 18 18"
            width={18}
            height={18}
            style={{ position: 'absolute', inset: 0 }}
            fill="none"
            stroke="white"
            strokeWidth={2}
          >
            <path d="M4 9 L8 13 L14 5" />
          </svg>
        )}
      </span>
      <input
        type="checkbox"
        checked={checked}
        {...rest}
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
      />
      {label && <span>{label}</span>}
    </label>
  );
}

type RadioProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: React.ReactNode;
};

export function Radio({ label, style, checked, ...rest }: RadioProps) {
  return (
    <label
      style={{
        display: 'inline-flex',
        gap: 10,
        alignItems: 'center',
        cursor: 'pointer',
        fontFamily: 'var(--font-body)',
        fontSize: 13,
        color: 'var(--fg-primary)',
        ...style,
      }}
    >
      <span
        style={{
          position: 'relative',
          width: 18,
          height: 18,
          borderRadius: '50%',
          border: `1px solid ${checked ? 'var(--threshold-purple)' : 'var(--input-border)'}`,
          background: 'var(--input-bg)',
          display: 'inline-block',
          flex: 'none',
        }}
      >
        {checked && (
          <span
            style={{
              position: 'absolute',
              top: 4,
              left: 4,
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--threshold-purple)',
            }}
          />
        )}
      </span>
      <input
        type="radio"
        checked={checked}
        {...rest}
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
      />
      {label && <span>{label}</span>}
    </label>
  );
}
