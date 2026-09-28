// swagger-ui-dist ships no type definitions; we only use this one function.
declare module 'swagger-ui-dist' {
  /** Absolute path of the folder that holds swagger-ui.css, swagger-ui-bundle.js, ... */
  export function getAbsoluteFSPath(): string;
}
