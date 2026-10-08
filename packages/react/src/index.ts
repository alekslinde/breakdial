// SPDX-FileCopyrightText: 2026 Aleks Linde
// SPDX-License-Identifier: Apache-2.0
// @breakdial/react — no JSX in source, so no pragma or JSX runtime needed.
import { createElement, useState } from 'react';
import type { ChangeEvent, InputHTMLAttributes, ReactElement } from 'react';
import { dial, getDial, getLevel } from '@breakdial/core';

/** `[level, setLevel]` — setLevel drives the engine, not just local state. */
export type UseBreakResult = [number, (n: number) => void];

export function useBreak(): UseBreakResult {
  const [level, setLevelState] = useState<number>(getLevel());
  const setLevel = (n: number): void => {
    // Carry the existing seed forward. Omitting it reseeds from Date.now()
    // on every slider move, so a reproducible run would stop reproducing
    // the moment someone touched the dial.
    dial(n, { seed: getDial().seed });
    setLevelState(getLevel());
  };
  return [level, setLevel];
}

/**
 * The dial's own `value` always wins, so a caller cannot desync the slider
 * from the engine; `value` is therefore omitted from the accepted props.
 */
export type BreakDialProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'type'>;

export function BreakDial(props: BreakDialProps = {}): ReactElement {
  const [level, setLevel] = useBreak();
  const { onChange, ...rest } = props;
  // `type` and `value` are set AFTER ...rest, so the component keeps control of
  // them. The Omit<> above is erased at runtime, and a plain-JS caller passing
  // type="text" would otherwise turn the slider into a text box.
  return createElement('input', {
    min: 0,
    max: 10,
    'aria-label': 'breakdial level',
    title: `breakdial level ${level}`,
    ...rest,
    type: 'range',
    value: level,
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      setLevel(Number(e.target.value));
      onChange?.(e);
    },
  });
}
