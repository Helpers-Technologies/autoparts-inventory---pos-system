import base from '../vitest.config.ts';
import { defineConfig } from 'vitest/config';
export default defineConfig({...base,test:{...base.test,include:['scripts/fin-01-store.audit.test.tsx'],maxWorkers:1,testTimeout:180000}});
