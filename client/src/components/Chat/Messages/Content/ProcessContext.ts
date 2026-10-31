import { createContext } from 'react';

/** Nested steps share a single request status instead of inventing pending steps. */
export const ProcessContext = createContext(false);
export const MermaidStreamContext = createContext(false);
