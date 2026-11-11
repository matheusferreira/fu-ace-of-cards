# Ace of Cards — versionamento

- Cada atualização do módulo deve aumentar a versão em `module.json` no mesmo conjunto de mudanças enviado à `main`. Confira as tags de release e use uma versão ainda inédita e superior à última publicada. Para correções, aumente o último número da versão.
- Atualize o campo `download` de `module.json` para apontar para a mesma versão e registre as mudanças em uma seção correspondente de `CHANGELOG.md`, no formato `## [X.Y.Z] - AAAA-MM-DD`.
- Antes do push, rode `node --test`. Depois do push à `main`, confira se o workflow **Release module** publicou a versão com os arquivos `module.json` e `module.zip`.
