// SPDX-FileCopyrightText: 2026 Aleks Linde
// SPDX-License-Identifier: Apache-2.0
// @breakdial/react — no JSX, no build step. Requires react as peer.
import { createElement, useState } from 'react';
import { dial, getDial, getLevel } from '@breakdial/core';

export function useBreak() {
  const [level, setLevelState] = useState(getLevel());
  const setLevel = (n) => {
    // Carry the existing seed forward. Omitting it reseeds from Date.now()
    // on every slider move, so a reproducible run would stop reproducing
    // the moment someone touched the dial.
    dial(n, { seed: getDial().seed });
    setLevelState(getLevel());
  };
  return [level, setLevel];
}

export function BreakDial(props = {}) {
  const [level, setLevel] = useBreak();
  // `value`/`onChange` come after ...props: the engine owns the value, and a
  // caller's onChange is chained rather than dropped.
  const { onChange, value: _ignored, ...rest } = props;
  return createElement('input', {
    type: 'range',
    min: 0,
    max: 10,
    'aria-label': 'breakdial level',
    title: `breakdial level ${level}`,
    ...rest,
    value: level,
    onChange: (e) => {
      setLevel(Number(e.target.value));
      onChange?.(e);
    },
  });
}
