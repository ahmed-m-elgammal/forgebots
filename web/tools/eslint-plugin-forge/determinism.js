// ForgeBots determinism plugin — spec-kit/10-DETERMINISM.md § 3 and
// spec-kit/23-WEB-CLIENT-PLAN.md § 3 (task 0.2). Flat-config plugin, no
// .eslintrc (D22). Scoped in this package to web/src/**; when the root
// workspace lands, the same plugin is what simulator/src/** imports.

const normalize = (filename) => filename.replaceAll('\\', '/');

const isMathModule = (filename) => normalize(filename).includes('/src/math/');

// Math.imul is the one sanctioned Math member: the integer 32-bit multiply
// Mulberry32 needs (10-DETERMINISM.md § 2.3). Allowed only inside the math
// module, mirroring the spec's "only via math.ts" exception.
const ALLOWED_MATH_MEMBERS = new Set(['imul']);

const noFloatLiteral = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      float:
        'Floating-point literal. Integer arithmetic only — no exceptions (10-DETERMINISM.md § 2.2).',
    },
  },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value !== 'number' || typeof node.raw !== 'string') {
          return;
        }
        if (/^0[xXbBoO]/.test(node.raw)) {
          return;
        }
        if (/[.eE]/.test(node.raw)) {
          context.report({ node, messageId: 'float' });
        }
      },
    };
  },
};

const noAmbientClock = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      clock:
        'Ambient clock is nondeterministic. Time is tick counts only (10-DETERMINISM.md § 3).',
    },
  },
  create(context) {
    const isClockRead = (callee) =>
      callee.type === 'MemberExpression' &&
      callee.computed === false &&
      callee.property.type === 'Identifier' &&
      callee.property.name === 'now' &&
      callee.object.type === 'Identifier' &&
      (callee.object.name === 'Date' || callee.object.name === 'performance');

    return {
      CallExpression(node) {
        if (isClockRead(node.callee)) {
          context.report({ node, messageId: 'clock' });
        }
      },
      NewExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'Date') {
          context.report({ node, messageId: 'clock' });
        }
      },
    };
  },
};

const noMathGlobals = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      math:
        'Math.* is platform-nondeterministic. Integer operators only; Math.imul is allowed inside src/math/ (10-DETERMINISM.md § 3).',
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (node.object.type !== 'Identifier' || node.object.name !== 'Math') {
          return;
        }
        if (
          node.computed === false &&
          node.property.type === 'Identifier' &&
          ALLOWED_MATH_MEMBERS.has(node.property.name) &&
          isMathModule(context.filename)
        ) {
          return;
        }
        context.report({ node, messageId: 'math' });
      },
    };
  },
};

const noConsoleInSource = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      console:
        'console output in src/ (10-DETERMINISM.md § 3 — allowed in tests only).',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'console'
        ) {
          context.report({ node, messageId: 'console' });
        }
      },
    };
  },
};

export const rules = {
  'no-float-literal': noFloatLiteral,
  'no-ambient-clock': noAmbientClock,
  'no-math-globals': noMathGlobals,
  'no-console-in-source': noConsoleInSource,
};

export default { rules };
