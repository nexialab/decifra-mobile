# UI/UX Pro Max Skill

## Overview
Expert UI/UX design skill for creating premium, ritualistic, and emotionally engaging mobile app interfaces.

## Capabilities
- Premium visual design systems
- Micro-interactions and animations
- Ritualistic user flows
- Typography and color theory
- Accessibility (WCAG 2.1)
- Design tokens and theming

## Design Principles for DECIFRA

### 1. Ritualistic Experience
- Create moments of reflection and intention
- Use transitions as "breathing spaces"
- Design for emotional resonance, not just functionality

### 2. Color System (Ártio Identity)
```typescript
export const COLORS_ARTIO = {
  // Primary gradient (from app icon)
  terracota: '#C45A3D',
  terracotaLight: '#E86645',
  terracotaDark: '#A04025',
  
  // Deep wine colors
  vinho: '#6B2D3A',
  vinhoDark: '#3D1A1E',
  vinhoDeep: '#2D1518',
  
  // Secondary
  ocre: '#C4A77D',
  ocreLight: '#D9BE94',
  
  // Neutrals (from icon)
  cream: '#F5F0E6',
  creamDark: '#E8E0D1',
  offWhite: '#FAF8F3',
  
  // Accents
  amber: '#B85C38',
  teal: '#5B8A8A',
  blueDeep: '#4A6FA5',
};
```

### 3. Typography Scale
```typescript
export const TYPOGRAPHY = {
  hero: { size: 40, weight: '700', lineHeight: 48 },
  h1: { size: 32, weight: '700', lineHeight: 40 },
  h2: { size: 24, weight: '600', lineHeight: 32 },
  h3: { size: 20, weight: '600', lineHeight: 28 },
  body: { size: 16, weight: '400', lineHeight: 24 },
  bodySmall: { size: 14, weight: '400', lineHeight: 20 },
  caption: { size: 12, weight: '500', lineHeight: 16 },
  button: { size: 16, weight: '600', lineHeight: 24 },
};
```

### 4. Spacing System
```typescript
export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
};
```

### 5. Animation Timing
```typescript
export const ANIMATION = {
  // Micro-interactions
  instant: 100,
  fast: 200,
  normal: 300,
  slow: 500,
  
  // Ritualistic transitions
  breathe: 800,
  meditative: 1200,
  ceremony: 2000,
  
  // Easing
  easeOut: [0, 0, 0.2, 1],
  easeIn: [0.4, 0, 1, 1],
  spring: { stiffness: 100, damping: 15 },
  breathe: { stiffness: 50, damping: 20 },
};
```

### 6. Station Themes (IPIP Test)
```typescript
export const STATION_THEMES = {
  1: {
    name: 'Como você pensa',
    color: '#5B8A8A',
    icon: 'cloud',
    element: 'air',
    description: 'Pensamentos, ideias, perspectivas',
  },
  2: {
    name: 'Como você age',
    color: '#C4A77D',
    icon: 'mountain',
    element: 'earth',
    description: 'Ações, hábitos, comportamentos',
  },
  3: {
    name: 'Como você conecta',
    color: '#4A6FA5',
    icon: 'water',
    element: 'water',
    description: 'Relações, emoções, conexões',
  },
  4: {
    name: 'Como você reage',
    color: '#B85C38',
    icon: 'flame',
    element: 'fire',
    description: 'Reações, instintos, energia',
  },
};
```

### 7. Shadow & Elevation
```typescript
export const SHADOWS = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  button: {
    shadowColor: '#C45A3D',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  floating: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 8,
  },
};
```

### 8. Border Radius
```typescript
export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
};
```

## Component Patterns

### Entry Screen
- Full gradient background
- Centered eye/spiral icon (animated pulse)
- Title with letter-spacing
- Subtitle with fade-in
- Two primary action buttons

### Test Station Screen
- Header with station indicator
- Progress bar with spring animation
- Question cards with scale 1-5
- Selected state with pop animation
- Smooth scroll between questions

### Result Screen
- Mandala/radar chart with draw animation
- Factor cards with staggered entrance
- Protocol recommendations
- Share/export actions

## Animation Patterns

### Page Transitions
```typescript
export const pageTransition = {
  initial: { opacity: 0, y: 20 },
  animate: { 
    opacity: 1, 
    y: 0,
    transition: { duration: 0.5, ease: [0, 0, 0.2, 1] }
  },
  exit: { 
    opacity: 0, 
    y: -20,
    transition: { duration: 0.3 }
  },
};
```

### Station Transition
```typescript
export const stationTransition = {
  // Exit current station
  exit: {
    opacity: 0,
    scale: 0.95,
    transition: { duration: 400, ease: [0.4, 0, 1, 1] }
  },
  // Pause for message
  message: {
    opacity: 1,
    scale: 1,
    transition: { duration: 600 }
  },
  // Enter new station
  enter: {
    opacity: 1,
    scale: 1,
    transition: { duration: 600, ease: [0, 0, 0.2, 1] }
  },
};
```

### Card Entrance (Staggered)
```typescript
export const staggeredCards = {
  container: {
    animate: {
      transition: { staggerChildren: 0.1 }
    }
  },
  item: {
    initial: { opacity: 0, y: 20 },
    animate: { 
      opacity: 1, 
      y: 0,
      transition: { duration: 0.5, ease: [0, 0, 0.2, 1] }
    }
  }
};
```

## Accessibility Guidelines

- Minimum touch target: 48×48dp
- Color contrast ratio: 4.5:1 minimum
- Support screen readers
- Respect reduced motion preferences
- Test with VoiceOver/TalkBack

## Best Practices

1. **Consistency**: Use design tokens everywhere
2. **Hierarchy**: Clear visual hierarchy with typography
3. **Feedback**: Every action has visual/haptic feedback
4. **Performance**: 60fps animations only
5. **Ritual**: Create intentional pauses in flows
6. **Emotion**: Design evokes curiosity and self-reflection

## DECIFRA Specific Patterns

### Code Input
- Auto-format: ART-XXXX
- Visual validation (green/red border)
- Shake animation on error
- Success pulse on valid

### Question Card
- Scale response buttons 1-5
- Highlight selected with accent color
- Smooth transition between questions
- Show progress per question

### Mandala Chart
- Animate path drawing on load
- Interactive touch on factors
- Pulse animation on data points
- Smooth transitions between profiles

### Protocol Card
- Icon representing the protocol type
- Title and description
- Duration badge
- Expand for exercises
- Checkmark when completed
