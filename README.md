# PDF Engenharia (MVP)

App local para trabalhar em cima de plantas em PDF com:

- calibracao de escala (2 pontos)
- dropdown de unidade padrao (m, cm, mm, km, in, ft)
- escala por pagina (cada pagina pode ter sua propria calibracao)
- medicao de distancia
- calculo de area e perimetro (poligono)
- barra de cota com offset ajustavel
- ima (snap) liga/desliga para maior precisao
- contagem por categoria (A, B, C, etc.)
- tabela automatica das marcacoes da pagina
- resumo de contagem por tag
- ocultar/mostrar tags por botao no resumo
- selecao de tag por clique no resumo para continuar marcando
- cor diferente para cada tag de contagem
- selecao de area para imprimir ou salvar em PNG

## Como executar

Como e um app estatico, voce pode abrir `index.html` direto no navegador.

Opcao recomendada (servidor local):

```bash
python3 -m http.server 8080
```

Depois abra:

- http://localhost:8080

## Fluxo de uso

1. Carregue um PDF.
2. Ajuste `Unidade` e `Dist. real` na barra superior.
3. Clique em `Escala (2 pontos)` e marque dois pontos conhecidos (na pagina atual).
4. Use `Distancia` para medir trechos.
5. Use `Area/Perimetro` para criar poligonos.
6. Feche o poligono com duplo clique, Enter, botao direito ou clicando perto do primeiro ponto.
7. Ajuste `Offset cota` para subir/descer a barra da cota.
8. Ligue/desligue `Ima` para facilitar encaixe de pontos com precisao.
9. Use `Contagem` com a tag desejada (`A`, `B`, `C` etc.).
10. Ao trocar a tag de contagem, a sequencia daquela tag reinicia.
11. Veja as tabelas no painel direito (marcacoes agrupadas com abrir/fechar).
12. Use `Selecionar area` para arrastar um retangulo e depois imprimir apenas a regiao.

## Observacoes

- Esta versao e um MVP para validar o fluxo tecnico.
- As marcacoes ficam em memoria enquanto a pagina estiver aberta.
- Para um proximo passo, da para evoluir para app desktop (Electron/Tauri), salvar projeto em JSON e gerar relatorio em XLSX/PDF.
