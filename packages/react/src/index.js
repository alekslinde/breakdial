// SPDX-FileCopyrightText: 2026 Aleks Linde
// SPDX-License-Identifier: Apache-2.0
// @breakdial/react — no JSX, no build step. Requires react as peer.
import { createElement, useState } from 'react';
import { dial, getLevel } from '@breakdial/core';

export function useBreak() {
  const [level, setLevelState] = useState(getLevel());
  const setLevel = (n) => {
    dial(n);
    setLevelState(getLevel());
  };
  return [level, setLevel];
}

export function BreakDial(props = {}) {
  const [level, setLevel] = useBreak();
  return createElement('input', {
    type: 'range',
    min: 0,
    max: 10,
    value: level,
    'aria-label': 'breakdial level',
    title: `breakdial level ${level}`,
    ...props,
    onChange: (e) => setLevel(Number(e.target.value)),
  });
}
