# Expo Skills - DECIFRA Mobile

## Overview

Skills especializadas para desenvolvimento com Expo SDK 54 e React Native no projeto DECIFRA (Avaliação de Personalidade Big Five).

---

## Skill: expo-app-design

### Description
Design e arquitetura de aplicativos Expo com foco em experiência ritualística e animações fluidas.

### When to Use
- Criar novas telas com gradientes e transições
- Implementar o fluxo de 4 estações temáticas
- Desenvolver componentes visuais orgânicos (mandala)

### Best Practices

#### 1. Estrutura de Navegação (Expo Router)
```typescript
// app/_layout.tsx
import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(teste)" options={{ animation: 'fade' }} />
    </Stack>
  );
}
```

#### 2. Gradientes e Cores (Identidade Ártio)
```typescript
// constants/colors.ts
export const COLORS = {
  // Paleta terracota → vinho
  terracota: '#C4785A',
  vinho: '#6B2D3A',
  ocre: '#C4A77D',
  ambar: '#B85C38',
  azulEsverdeado: '#5B8A8A',
  azulProfundo: '#4A6FA5',
  
  // Gradientes
  gradient: ['#C4785A', '#8B4545', '#6B2D3A'] as const,
  gradientButton: ['#D4896A', '#B55A4A'] as const,
  
  // Neutros
  cream: '#F5F0E8',
  creamLight: '#FAF8F5',
  textDark: '#2D2420',
};
```

#### 3. Animações com Reanimated
```typescript
// Componente de transição entre estações
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  Easing,
} from 'react-native-reanimated';

const stationTransition = {
  exit: {
    opacity: 0,
    scale: 0.95,
    transition: { 
      duration: 400, 
      easing: Easing.out(Easing.ease) 
    }
  },
  enter: {
    opacity: 1,
    scale: 1,
    transition: { 
      duration: 600, 
      easing: Easing.out(Easing.ease) 
    }
  }
};
```

### Common Pitfalls
- ⚠️ Não usar `Animated` do React Native para animações complexas (use Reanimated)
- ⚠️ Sempre testar em dispositivo físico, não apenas em simulador
- ⚠️ Usar `SafeAreaView` para respeitar áreas seguras do iPhone

---

## Skill: upgrading-expo

### Description
Guia para atualizar versões do Expo e gerenciar breaking changes.

### When to Use
- Atualizar Expo SDK
- Resolver conflitos de dependências
- Migrar código legacy

### Upgrade Process

#### 1. Preparação
```bash
# Backup do projeto
git add . && git commit -m "chore: backup before expo upgrade"

# Verificar dependências desatualizadas
npm outdated
```

#### 2. Upgrade Expo SDK
```bash
# Instalar latest Expo CLI
npm install -g expo-cli

# Upgrade automático
expo upgrade

# Ou para versão específica
expo upgrade 54
```

#### 3. Pós-Upgrade Checklist
- [ ] Limpar cache: `expo start -c`
- [ ] Testar em iOS e Android
- [ ] Verificar deprecations no console
- [ ] Atualizar eas.json se necessário

### Breaking Changes Comuns

| Expo SDK | Change | Solution |
|----------|--------|----------|
| 53 → 54 | React Native 0.81 | Atualizar metro.config.js |
| 52 → 53 | Expo Router v6 | Atualizar imports de navigation |
| 51 → 52 | New Architecture | Testar com `newArchEnabled` |

---

## Skill: expo-deployment

### Description
Deploy de aplicativos Expo usando EAS Build e distribuição nas lojas.

### When to Use
- Criar builds de produção
- Configurar CI/CD
- Publicar na App Store/Play Store

### EAS Build Configuration

#### 1. eas.json
```json
{
  "cli": {
    "version": ">= 14.0.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "channel": "preview"
    },
    "production": {
      "channel": "production"
    }
  },
  "submit": {
    "production": {
      "ios": {
        "ascAppId": "YOUR_APP_ID"
      }
    }
  }
}
```

#### 2. Build Commands
```bash
# Development build
 eas build --profile development --platform ios
 eas build --profile development --platform android

# Preview (Internal Testing)
eas build --profile preview --platform all

# Production
 eas build --profile production --platform all
```

#### 3. Environment Variables no EAS
```bash
# Configurar secrets
eas secret:create --name SUPABASE_URL --value "https://..."
eas secret:create --name SUPABASE_ANON_KEY --value "eyJ..."
```

### App Store / Play Store

#### iOS (App Store Connect)
```bash
# Configurar app.json
{
  "ios": {
    "bundleIdentifier": "com.artio.decifra",
    "buildNumber": "1.0.0"
  }
}

# Submit
 eas submit -p ios
```

#### Android (Google Play)
```bash
# Configurar app.json
{
  "android": {
    "package": "com.artio.decifra",
    "versionCode": 1
  }
}

# Submit
 eas submit -p android
```

---

## Tool Calling

Quando usar essas skills:
- `@dev` criar novas telas com design system
- `@architect` planejar migrações de Expo
- `@devops` configurar pipelines de build

---

## Examples

### Exemplo: Tela com Gradiente Ritualístico
```tsx
// app/cliente/estacao1.tsx
import { LinearGradient } from 'expo-linear-gradient';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS } from '@/constants/colors';

export default function Estacao1Screen() {
  return (
    <LinearGradient
      colors={['#5B8A8A', '#4A6FA5']} // Céu → Água
      style={styles.container}
    >
      <Text style={styles.title}>Como você pensa</Text>
      {/* Questões da estação 1 */}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  title: { 
    fontSize: 28, 
    color: COLORS.creamLight,
    fontWeight: '600'
  }
});
```

---

## Related Skills
- `react-native-best-practices`
- `react-native-performance`
- `supabase-integration`
