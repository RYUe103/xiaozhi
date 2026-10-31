import { createContext } from 'react';
import type { TAttachment } from 'librechat-data-provider';

// Scoped to the assistant answer; tool details and other messages keep their links.
export const FileOutputContext = createContext<TAttachment[]>([]);
