# React Native Skills - DECIFRA Mobile

## Overview

Best practices e otimizações para React Native no projeto DECIFRA, focando em performance e experiência do usuário.

---

## Skill: react-native-best-practices

### Description
Padrões e práticas recomendadas para desenvolvimento React Native de alta qualidade.

### When to Use
- Criar novos componentes
- Refatorar código existente
- Definir padrões de projeto

### Component Patterns

#### 1. Functional Components com Hooks
```typescript
// ✅ Bom
interface Props {
  clienteId: string;
  onComplete: () => void;
}

export const TesteProgresso: React.FC<Props> = ({ clienteId, onComplete }) => {
  const [progresso, setProgresso] = useState(0);
  const { respostas, salvarResposta } = useTeste(clienteId);
  
  return (
    <View>
      <ProgressBar progress={progresso} />
      {/* ... */}
    </View>
  );
};

// ❌ Evitar: Class components
class TesteProgresso extends React.Component<Props> {
  // ...
}
```

#### 2. Custom Hooks para Lógica Reutilizável
```typescript
// hooks/useTeste.ts
export const useTeste = (clienteId: string) => {
  const [respostas, setRespostas] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    carregarRespostas();
  }, [clienteId]);
  
  const salvarResposta = useCallback(async (questaoId: number, resposta: number) => {
    const novasRespostas = { ...respostas, [questaoId]: resposta };
    setRespostas(novasRespostas);
    await AsyncStorage.setItem(`respostas_${clienteId}`, JSON.stringify(novasRespostas));
  }, [respostas, clienteId]);
  
  return { respostas, salvarResposta, loading };
};
```

#### 3. Memoização de Componentes
```typescript
// ✅ Usar memo para componentes que recebem props complexas
export const Mandala = memo<MandalaProps>(({ scores, onSelect }) => {
  // Componente pesado de gráfico SVG
  return (
    <SVG width={300} height={300}>
      {/* ... */}
    </SVG>
  );
}, (prev, next) => {
  // Custom comparison
  return JSON.stringify(prev.scores) === JSON.stringify(next.scores);
});
```

### State Management

#### 1. Zustand para Estado Global
```typescript
// stores/testeStore.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface TesteState {
  respostas: Record<number, number>;
  estacaoAtual: number;
  setResposta: (questaoId: number, resposta: number) => void;
  setEstacao: (estacao: number) => void;
  reset: () => void;
}

export const useTesteStore = create<TesteState>()(
  persist(
    (set) => ({
      respostas: {},
      estacaoAtual: 1,
      setResposta: (questaoId, resposta) =>
        set((state) => ({
          respostas: { ...state.respostas, [questaoId]: resposta }
        })),
      setEstacao: (estacao) => set({ estacaoAtual: estacao }),
      reset: () => set({ respostas: {}, estacaoAtual: 1 })
    }),
    {
      name: 'teste-storage',
      storage: createJSONStorage(() => AsyncStorage)
    }
  )
);
```

### TypeScript Best Practices

#### 1. Strict Types
```typescript
// ✅ Usar tipos estritos
export type FatorKey = 'N' | 'E' | 'O' | 'A' | 'C';
export type Classificacao = 'Muito Baixo' | 'Baixo' | 'Médio' | 'Alto' | 'Muito Alto';

export interface ScoreFaceta {
  faceta: `${FatorKey}${1 | 2 | 3 | 4 | 5 | 6}`;
  score: number;
  percentil: number;
  classificacao: Classificacao;
}

// ❌ Evitar any
function calcular(resultado: any) { }
```

#### 2. Discriminated Unions
```typescript
export type TesteStatus = 
  | { status: 'pendente' }
  | { status: 'em_andamento'; estacao: number; progresso: number }
  | { status: 'completo'; resultadoId: string };
```

---

## Skill: react-native-performance

### Description
Otimizações de performance para React Native: 60fps, redução de re-renders, memória.

### When to Use
- Scroll não está fluido
- App lento em dispositivos antigos
- Animações travando

### Performance Checklist

#### 1. Lista Otimizada (FlatList)
```typescript
// ✅ Usar FlatList com otimizações
<FlatList
  data={questoes}
  keyExtractor={(item) => item.id.toString()}
  renderItem={renderQuestao}
  getItemLayout={(data, index) => ({
    length: ITEM_HEIGHT,
    offset: ITEM_HEIGHT * index,
    index
  })}
  initialNumToRender={10}
  maxToRenderPerBatch={10}
  windowSize={5}
  removeClippedSubviews={true}
  updateCellsBatchingPeriod={50}
  // Importante para listas grandes
  getItemLayout={getItemLayout}
  // Memoizar renderItem
  renderItem={renderItem}
/>

// Memoizar renderItem
const renderItem = useCallback(({ item }: { item: Questao }) => (
  <QuestaoCard questao={item} />
), []);
```

#### 2. Animações em Thread Nativa
```typescript
// ✅ Animar propriedades nativas apenas
const translateX = useSharedValue(0);

const animatedStyle = useAnimatedStyle(() => ({
  transform: [{ translateX: translateX.value }],
  // ❌ Não animar layout properties
  // height: height.value, // Lento!
}));

// ✅ Usar transform e opacity apenas
```

#### 3. Image Optimization (expo-image)
```typescript
import { Image } from 'expo-image';

<Image
  source={{ uri: 'https://...' }}
  style={{ width: 200, height: 200 }}
  contentFit="cover"
  transition={200}
  cachePolicy="memory-disk"
  priority="high"
/>
```

#### 4. Code Splitting
```typescript
// ✅ Lazy load telas pesadas
const ResultadoScreen = lazy(() => import('./resultado'));

// Com Suspense
<Suspense fallback={<Loading />}>
  <ResultadoScreen />
</Suspense>
```

### Memory Management

#### 1. Cleanup de Subscriptions
```typescript
useEffect(() => {
  const subscription = supabase
    .channel('teste')
    .on('postgres_changes', { event: '*', schema: 'public' }, callback)
    .subscribe();
  
  return () => {
    subscription.unsubscribe(); // ✅ Cleanup
  };
}, []);
```

#### 2. Large List Optimization
```typescript
// ✅ Virtualização para listas muito grandes
import { FlashList } from '@shopify/flash-list';

<FlashList
  data={respostas}
  renderItem={renderItem}
  estimatedItemSize={50}
  // 2x mais rápido que FlatList
/>
```

### Network Optimization

#### 1. React Query para Cache
```typescript
// hooks/useResultado.ts
export const useResultado = (clienteId: string) => {
  return useQuery({
    queryKey: ['resultado', clienteId],
    queryFn: () => fetchResultado(clienteId),
    staleTime: 5 * 60 * 1000, // 5 minutos
    cacheTime: 30 * 60 * 1000, // 30 minutos
    // Não refetch on window focus em mobile
    refetchOnWindowFocus: false
  });
};
```

### Performance Monitoring

#### 1. Flipper (Desenvolvimento)
```bash
# Instalar plugin
npx pod-install ios

# Usar para debug de:
# - Network requests
# - AsyncStorage
# - Performance
```

#### 2. Expo Insights (Produção)
```typescript
// app.json
{
  "plugins": [
    [
      "expo-insights",
      {
        "projectId": "..."
      }
    ]
  ]
}
```

---

## Specific Optimizations for DECIFRA

### 1. Otimização do Teste (120 Questões)
```typescript
// ✅ Paginação virtual
const QuestoesPaginadas = () => {
  const [paginaAtual, setPaginaAtual] = useState(0);
  const questoesPorPagina = 5;
  
  // Render apenas 5 questões por vez
  const questoesVisiveis = questoes.slice(
    paginaAtual * questoesPorPagina,
    (paginaAtual + 1) * questoesPorPagina
  );
  
  return (
    <View>
      {questoesVisiveis.map(q => <Questao key={q.id} {...q} />)}
    </View>
  );
};
```

### 2. Mandala SVG Otimizada
```typescript
// ✅ Usar React Native SVG com cuidado
import Svg, { Path, Circle } from 'react-native-svg';

// Memoizar paths
const MandalaPath = memo(({ d, color }: Props) => (
  <Path d={d} fill={color} />
));

// Limitar re-renders durante animação
const Mandala = ({ scores }: { scores: number[] }) => {
  const [animatedScores, setAnimatedScores] = useState(scores);
  
  useEffect(() => {
    // Animação controlada
    const interval = setInterval(() => {
      setAnimatedScores(prev => 
        prev.map((s, i) => s + (scores[i] - s) * 0.1)
      );
    }, 16);
    
    return () => clearInterval(interval);
  }, [scores]);
  
  return (
    <Svg width={300} height={300}>
      {animatedScores.map((score, i) => (
        <MandalaPath key={i} d={paths[i]} color={colors[i]} />
      ))}
    </Svg>
  );
};
```

---

## Tool Calling

Quando usar essas skills:
- `@dev` otimizar componentes existentes
- `@qa` identificar problemas de performance
- `@architect` definir padrões de performance

---

## Metrics

### Performance Targets para DECIFRA

| Métrica | Target | Máximo Aceitável |
|---------|--------|------------------|
| Tempo de inicialização | < 2s | 3s |
| FPS durante scroll | 60 | 45 |
| FPS durante animações | 60 | 30 |
| Tempo de cálculo de scores | < 1s | 2s |
| TTI (Time to Interactive) | < 3s | 5s |

---

## Related Skills
- `expo-app-design`
- `supabase-integration`
- `mobile-testing`
