"use strict";
/**
 * Lensy v2 Detection Types
 *
 * Evidence-aware types for the 3-phase detection architecture.
 * These are the shared contract between backend detection engine and frontend UI.
 *
 * @see docs/lensy-v2-implementation-spec.md
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.notVerifiedSignal = notVerifiedSignal;
exports.experimentalSignal = experimentalSignal;
// ── Helper: create default "not verified" signal ────────────────────────
function notVerifiedSignal(audience) {
    return { status: 'not_verified', audience };
}
function experimentalSignal(method, audience) {
    return { status: 'experimental', method, audience };
}
