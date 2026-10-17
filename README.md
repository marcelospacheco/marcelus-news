# Marcelus News

Agregador de notícias de política e eleições. O texto de cada matéria vem do feed RSS da fonte, com crédito e link para o veículo original.

## Como rodar

```bash
npm install
python3 -m venv collector/.venv
collector/.venv/bin/pip install -r collector/requirements.txt
npm run dev
```

O site sobe em desenvolvimento e o coletor Python busca os feeds de política. Sem o coletor, o próprio app continua lendo os RSS.

## O que entra no repositório

Código do site (`src/`), coletor (`collector/`), migrações do banco (`migrations/`) e a página pública. `node_modules` e o ambiente Python não vão junto.
