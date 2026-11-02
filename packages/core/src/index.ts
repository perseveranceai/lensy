// SPDX-License-Identifier: MIT
declare const __LENSY_CORE_VERSION__: string;
declare const __ENGINE_COMMIT__: string;

export const VERSION: string = typeof __LENSY_CORE_VERSION__ === 'string' ? __LENSY_CORE_VERSION__ : '0.0.0';
export const ENGINE_COMMIT: string = typeof __ENGINE_COMMIT__ === 'string' ? __ENGINE_COMMIT__ : 'unknown';
