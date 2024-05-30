import type { Config } from 'tailwindcss';
import colors from 'tailwindcss/colors';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    colors: {
      ...colors,
      'destructive-red': 'black',
      'subtle-accent': '#E5EAFF',
      'send-pill': '#FFFAED',
      'logout-red': 'red',
      'receive-pill': '#FFFAED',
    },
  },
  plugins: [],
};
export default config;
