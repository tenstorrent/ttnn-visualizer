// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import hljs from 'highlight.js/lib/core';
import cpp from 'highlight.js/lib/languages/cpp';
import python from 'highlight.js/lib/languages/python';
import 'highlight.js/styles/a11y-dark.css';
import { StackTraceLanguage } from '../definitions/StackTrace';

hljs.registerLanguage(StackTraceLanguage.PYTHON, python);
hljs.registerLanguage(StackTraceLanguage.CPP, cpp);

export default hljs;
