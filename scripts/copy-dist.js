import { cpSync } from 'fs';

cpSync('web-vue/dist', 'public', { recursive: true });
cpSync('web-vue/dist', 'docs', { recursive: true });
console.log('Copied web-vue/dist → public/ and docs/');
