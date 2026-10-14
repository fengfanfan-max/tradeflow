// Tailwind v4 is a PostCSS plugin. There is deliberately no tailwind.config.js:
// the design tokens live in `src/app/globals.css` under `@theme`, which is the
// v4 idiom and keeps colour decisions next to the components that read them.
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
