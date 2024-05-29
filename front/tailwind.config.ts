import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    colors: {
      'destructive-red': 'black',
      'subtle-accent': '#E5EAFF',
      'send-pill': '#FFFAED',
      'receive-pill': '#FFFAED',
    },
  },
  plugins: [],
};
export default config;
