// Design tokens for Breadcrumbs. Never hardcode colors/spacing in components — import from here.

export const colors = {
  primary: '#E8A33D', // golden crust
  toast: '#B5651D', // deep toast — accents, text on light surfaces
  cream: '#FFF4DE', // crumb cream — backgrounds
  blush: '#F4A39A', // highlights, dropped Breadcrumbs
  ink: '#2B1B12', // primary text
  white: '#FFFFFF',
  success: '#6FA86F',
  danger: '#C65B4E',
  outline: '#E7D4B8', // undropped breadcrumb / card borders
} as const;

export const radius = {
  sm: 8,
  md: 16,
  lg: 24,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const typography = {
  display: 'Baloo2_700Bold',
  body: 'Nunito_400Regular',
  bodyBold: 'Nunito_700Bold',
} as const;

export const shadow = {
  card: {
    shadowColor: colors.toast,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 3,
  },
} as const;
