const color = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Geist Variable', 'sans-serif'],
        heading: ['Geist Variable', 'sans-serif'],
      },
      colors: {
        background: color('background'),
        foreground: color('foreground'),
        card: { DEFAULT: color('card'), foreground: color('card-foreground') },
        popover: {
          DEFAULT: color('popover'),
          foreground: color('popover-foreground'),
        },
        primary: {
          DEFAULT: color('primary'),
          foreground: color('primary-foreground'),
        },
        secondary: {
          DEFAULT: color('secondary'),
          foreground: color('secondary-foreground'),
        },
        muted: {
          DEFAULT: color('muted'),
          foreground: color('muted-foreground'),
        },
        accent: {
          DEFAULT: color('accent'),
          foreground: color('accent-foreground'),
        },
        destructive: color('destructive'),
        success: {
          DEFAULT: color('success'),
          foreground: color('success-foreground'),
        },
        warning: color('warning'),
        'brand-panel': color('brand-panel'),
        border: color('border'),
        input: color('input'),
        ring: color('ring'),
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [],
};
