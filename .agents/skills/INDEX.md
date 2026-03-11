# Skills Index - DECIFRA Mobile

## 📚 Skills Disponíveis

### Expo Skills (`expo/`)

| Skill | Descrição | Uso |
|-------|-----------|-----|
| `expo-app-design` | Design e arquitetura de apps Expo | Criar telas, componentes visuais |
| `upgrading-expo` | Atualização de versões Expo | Migrações, breaking changes |
| `expo-deployment` | Deploy com EAS Build | CI/CD, publicação nas lojas |

### React Native Skills (`react-native/`)

| Skill | Descrição | Uso |
|-------|-----------|-----|
| `react-native-best-practices` | Padrões e boas práticas | Componentes, hooks, TypeScript |
| `react-native-performance` | Otimizações de performance | 60fps, memória, network |

---

## 🚀 Como Usar as Skills

### No AIOX (Claude Code / Cursor)

As skills são referenciadas automaticamente quando você ativa um agent:

```bash
# Ativar agent de desenvolvimento
@dev

# O agent já tem acesso às skills de:
# - expo-app-design
# - react-native-best-practices
# - react-native-performance
```

### Exemplo de Uso

**Usuário:** `@dev Preciso criar uma tela de transição entre estações do teste`

**Agent (@dev):** Irá consultar as skills `expo-app-design` e `react-native-best-practices` para:
1. Usar Reanimated para animações fluidas
2. Aplicar gradientes da identidade Ártio
3. Seguir padrões de componentes funcionais
4. Otimizar para 60fps

---

## 📝 Estrutura de Skills

```
.agents/skills/
├── INDEX.md              # Este arquivo
├── expo/
│   └── SKILL.md          # Skills de Expo
└── react-native/
    └── SKILL.md          # Skills de React Native
```

---

## 🔧 Adicionar Novas Skills

Para adicionar uma nova skill:

1. Criar diretório: `.agents/skills/<categoria>/`
2. Criar arquivo: `SKILL.md`
3. Seguir o formato:
   ```markdown
   # Nome da Skill
   
   ## Overview
   Descrição breve
   
   ## Skill: nome-da-skill
   
   ### Description
   Descrição detalhada
   
   ### When to Use
   Quando usar
   
   ### Best Practices
   - Prática 1
   - Prática 2
   
   ### Examples
   ```typescript
   // Código exemplo
   ```
   ```

4. Atualizar este INDEX.md

---

## 🎯 Skills Recomendadas por Fase

### Fase 1: Correções Fundamentais
- `react-native-best-practices` - Padronização de código
- `expo-app-design` - Atualização de cores e layout

### Fase 2: Animações
- `expo-app-design` - Transições e gradientes
- `react-native-performance` - 60fps, otimização

### Fase 3: Protocolos
- `react-native-best-practices` - State management com Zustand

### Fase 4: Integrações
- `expo-deployment` - EAS Build, CI/CD
- `upgrading-expo` - Manutenção de versões

### Fase 5: Polish
- `react-native-performance` - Performance final

---

## 📖 Referências

- [Expo Documentation](https://docs.expo.dev)
- [React Native Documentation](https://reactnative.dev)
- [React Native Reanimated](https://docs.swmansion.com/react-native-reanimated/)
- [React Navigation](https://reactnavigation.org)
