// Runtime evaluation of the DSL's pure builtins — the execution half of the
// 09 § 4 table. 06-ARCHITECTURE.md § 2 and AGENTS.md § 6 place math /
// compare / boolean / trig builtins in program/; execution/vm.ts dispatches
// here for them and to the VmEnv seam for everything world-facing.
//
// Semantics the spec leaves open, fixed here and pinned by tests:
// - DSL ints are int32 (09 § 2.3, literals capped at INT_LITERAL_LIMIT by
//   the compiler). Arithmetic SATURATES at ±(2^31 − 1), mirroring math/fixed
//   — wrapping would silently invert signs, which is worse than clamping.
// - Variadic + - * / fold left-to-right, saturating at every step: the IR
//   keeps one call node, so the fold order is the tree-walk's own.
// - Division truncates toward zero (C semantics, like math/fixed.div);
//   division by zero saturates toward the numerator's sign (legacy/01 § 2).
// - mod takes the dividend's sign; mod-by-zero is 0 — the residue class is
//   empty, and a NaN must never enter integer state (10-DETERMINISM § 2.2).
// - and / or fold eagerly: they are plain call nodes in the IR, so all
//   arguments evaluate. The verifier's proven-some analysis rejects payload
//   reads outside some?-guarded branches, so eagerness cannot trap.
// - Trig and distance are the fixed tables / integer sqrt of math/ (D1,
//   10-DETERMINISM § 2.2). dist floors, like every exactness-losing op.

import { BUILTIN_NAME, INT_LITERAL_LIMIT } from './compiler';
import { fcos, fatan2, fsin } from '../math/angle';
import { isqrt } from '../math/fixed';

const INT_MIN = -INT_LITERAL_LIMIT;

function saturate(value: bigint): number {
  if (value > BigInt(INT_LITERAL_LIMIT)) return INT_LITERAL_LIMIT;
  if (value < BigInt(INT_MIN)) return INT_MIN;
  return Number(value);
}

function intArg(name: string, args: readonly unknown[], index: number): number {
  const value = args[index];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new TypeError(
      `${name} argument ${index + 1} must be an integer, got ${String(value)}`,
    );
  }
  return value;
}

function boolArg(name: string, args: readonly unknown[], index: number): boolean {
  const value = args[index];
  if (typeof value !== 'boolean') {
    throw new TypeError(
      `${name} argument ${index + 1} must be a boolean, got ${String(value)}`,
    );
  }
  return value;
}

// Variadic rows have a BUILTINS minimum arity; the verifier enforces it for
// compiled programs and this guard keeps direct calls equally honest.
function requireMinArgs(name: string, args: readonly unknown[], min: number): void {
  if (args.length < min) {
    throw new TypeError(`${name} needs at least ${min} argument(s), got ${args.length}`);
  }
}

function divStep(numerator: number, denominator: number): number {
  if (denominator === 0) return numerator >= 0 ? INT_LITERAL_LIMIT : INT_MIN;
  return saturate(BigInt(numerator) / BigInt(denominator));
}

function dist(x1: number, y1: number, x2: number, y2: number): number {
  const dx = BigInt(x2 - x1);
  const dy = BigInt(y2 - y1);
  const squared = dx * dx + dy * dy;
  const root = isqrt(squared);
  return root > INT_LITERAL_LIMIT ? INT_LITERAL_LIMIT : root;
}

// The name is known to be a pure builtin — the VM routes only 09 § 4 rows
// with a computable result here and validates argument types against the
// BUILTINS row first. A TypeError from an arg read is a caller contract
// violation, not a bot-reachable condition.
export function evalPureBuiltin(
  name: string,
  args: readonly (number | boolean)[],
): number | boolean {
  switch (name) {
    case BUILTIN_NAME.add: {
      requireMinArgs(name, args, 1);
      let sum = 0;
      for (let i = 0; i < args.length; i++) {
        sum = saturate(BigInt(sum) + BigInt(intArg(name, args, i)));
      }
      return sum;
    }
    case BUILTIN_NAME.sub: {
      requireMinArgs(name, args, 1);
      if (args.length === 1) return -intArg(name, args, 0);
      let diff = intArg(name, args, 0);
      for (let i = 1; i < args.length; i++) {
        diff = saturate(BigInt(diff) - BigInt(intArg(name, args, i)));
      }
      return diff;
    }
    case BUILTIN_NAME.mul: {
      requireMinArgs(name, args, 1);
      let product = 1;
      for (let i = 0; i < args.length; i++) {
        product = saturate(BigInt(product) * BigInt(intArg(name, args, i)));
      }
      return product;
    }
    case BUILTIN_NAME.div: {
      requireMinArgs(name, args, 2);
      let quotient = intArg(name, args, 0);
      for (let i = 1; i < args.length; i++) {
        quotient = divStep(quotient, intArg(name, args, i));
      }
      return quotient;
    }
    case BUILTIN_NAME.mod: {
      const numerator = intArg(name, args, 0);
      const denominator = intArg(name, args, 1);
      if (denominator === 0) return 0;
      return numerator % denominator;
    }
    case BUILTIN_NAME.abs: {
      const value = intArg(name, args, 0);
      return value < 0 ? -value : value;
    }
    case BUILTIN_NAME.min: {
      requireMinArgs(name, args, 1);
      let smallest = intArg(name, args, 0);
      for (let i = 1; i < args.length; i++) {
        const candidate = intArg(name, args, i);
        if (candidate < smallest) smallest = candidate;
      }
      return smallest;
    }
    case BUILTIN_NAME.max: {
      requireMinArgs(name, args, 1);
      let largest = intArg(name, args, 0);
      for (let i = 1; i < args.length; i++) {
        const candidate = intArg(name, args, i);
        if (candidate > largest) largest = candidate;
      }
      return largest;
    }
    case BUILTIN_NAME.lessThan:
      return intArg(name, args, 0) < intArg(name, args, 1);
    case BUILTIN_NAME.lessOrEqual:
      return intArg(name, args, 0) <= intArg(name, args, 1);
    case BUILTIN_NAME.greaterThan:
      return intArg(name, args, 0) > intArg(name, args, 1);
    case BUILTIN_NAME.greaterOrEqual:
      return intArg(name, args, 0) >= intArg(name, args, 1);
    case BUILTIN_NAME.equals:
      return intArg(name, args, 0) === intArg(name, args, 1);
    case BUILTIN_NAME.notEquals:
      return intArg(name, args, 0) !== intArg(name, args, 1);
    case BUILTIN_NAME.not:
      return !boolArg(name, args, 0);
    case BUILTIN_NAME.and: {
      // Validation is a separate pass from the fold: every argument is
      // type-checked even when the first one already decides the result.
      requireMinArgs(name, args, 1);
      const operands = args.map((_, i) => boolArg(name, args, i));
      return operands.every((value) => value);
    }
    case BUILTIN_NAME.or: {
      requireMinArgs(name, args, 1);
      const operands = args.map((_, i) => boolArg(name, args, i));
      return operands.some((value) => value);
    }
    case BUILTIN_NAME.dist:
      return dist(
        intArg(name, args, 0),
        intArg(name, args, 1),
        intArg(name, args, 2),
        intArg(name, args, 3),
      );
    case BUILTIN_NAME.sin:
      return fsin(intArg(name, args, 0));
    case BUILTIN_NAME.cos:
      return fcos(intArg(name, args, 0));
    case BUILTIN_NAME.atan2:
      return fatan2(intArg(name, args, 0), intArg(name, args, 1));
    default:
      throw new TypeError(`'${name}' is not a pure builtin`);
  }
}
