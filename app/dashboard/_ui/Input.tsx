import * as React from 'react';

const baseInput: React.CSSProperties = {
  width: '100%',
  height: 'var(--input-height)',
  padding: '0 var(--input-pad-x)',
  background: 'var(--input-bg)',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--input-border)',
  color: 'var(--input-fg)',
  fontFamily: 'var(--font-body)',
  fontSize: 14,
  borderRadius: 8,
  outline: 'none',
  transition: 'background-color .2s, border-color .2s, box-shadow .2s',
};

const focusedShadow = 'var(--focus-ring)';

function applyFocus(el: HTMLElement) {
  el.style.borderColor = 'var(--threshold-purple)';
  el.style.boxShadow = focusedShadow;
  el.style.background = 'var(--input-bg-hover)';
}
function clearFocus(el: HTMLElement, errored = false) {
  el.style.borderColor = errored ? 'var(--input-border-error)' : 'var(--input-border)';
  el.style.boxShadow = '';
  el.style.background = 'var(--input-bg)';
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  errored?: boolean;
};

export function Input({ errored, style, onFocus, onBlur, ...rest }: InputProps) {
  return (
    <input
      {...rest}
      style={{
        ...baseInput,
        borderColor: errored ? 'var(--input-border-error)' : baseInput.borderColor,
        ...style,
      }}
      onFocus={(e) => {
        applyFocus(e.currentTarget);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        clearFocus(e.currentTarget, errored);
        onBlur?.(e);
      }}
    />
  );
}

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  errored?: boolean;
};

export function Textarea({ errored, style, onFocus, onBlur, ...rest }: TextareaProps) {
  return (
    <textarea
      {...rest}
      style={{
        ...baseInput,
        height: 'auto',
        minHeight: 96,
        padding: '12px 14px',
        lineHeight: 1.55,
        borderColor: errored ? 'var(--input-border-error)' : baseInput.borderColor,
        resize: 'vertical',
        ...style,
      }}
      onFocus={(e) => {
        applyFocus(e.currentTarget);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        clearFocus(e.currentTarget, errored);
        onBlur?.(e);
      }}
    />
  );
}

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  errored?: boolean;
};

export function Select({ errored, style, onFocus, onBlur, children, ...rest }: SelectProps) {
  return (
    <select
      {...rest}
      style={{
        ...baseInput,
        appearance: 'none',
        WebkitAppearance: 'none',
        backgroundImage:
          'linear-gradient(45deg, transparent 50%, var(--fg-secondary) 50%), linear-gradient(135deg, var(--fg-secondary) 50%, transparent 50%)',
        backgroundPosition: 'right 18px top 50%, right 12px top 50%',
        backgroundSize: '6px 6px, 6px 6px',
        backgroundRepeat: 'no-repeat',
        paddingRight: 32,
        borderColor: errored ? 'var(--input-border-error)' : baseInput.borderColor,
        ...style,
      }}
      onFocus={(e) => {
        applyFocus(e.currentTarget);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        clearFocus(e.currentTarget, errored);
        onBlur?.(e);
      }}
    >
      {children}
    </select>
  );
}

type FieldLabelProps = {
  children: React.ReactNode;
  required?: boolean;
  htmlFor?: string;
  style?: React.CSSProperties;
};

export function FieldLabel({ children, required, htmlFor, style }: FieldLabelProps) {
  return (
    <label
      htmlFor={htmlFor}
      style={{
        display: 'block',
        fontFamily: 'var(--font-ui)',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.22em',
        textTransform: 'uppercase',
        color: 'var(--fg-secondary)',
        marginBottom: 8,
        ...style,
      }}
    >
      {children}
      {required && <span style={{ color: 'var(--threshold-purple)', marginLeft: 4 }}>*</span>}
    </label>
  );
}
