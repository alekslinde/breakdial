<!--
SPDX-FileCopyrightText: 2026 Aleks Linde
SPDX-License-Identifier: Apache-2.0
-->

# @breakdial/react

A slider and a hook for driving the BreakDial level from a dev UI.

```bash
npm install @breakdial/react @breakdial/core
```

`react` and `@breakdial/core` are peer dependencies, so the app and the adapters
all share one dial instance.

```tsx
import { BreakDial, useBreak } from '@breakdial/react'

// a range input bound to the dial
<BreakDial />

// or drive it yourself
const [level, setLevel] = useBreak()
```

## Notes

`<BreakDial/>` owns its `type` and `value`: the engine is the source of truth, so
a caller cannot desync the slider from the dial or turn it into another kind of
input. Other input props (`className`, `style`, `disabled`, …) pass through, and
a supplied `onChange` is chained after the dial updates.

Moving the slider preserves the current seed, so a reproducible run keeps
reproducing.

No JSX in the source, so there is no JSX runtime or pragma to configure.

## Licence

Apache-2.0. See [NOTICE](https://github.com/alekslinde/breakdial/blob/main/NOTICE).
