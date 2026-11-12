# MultiZen 4G Conveyor v2.1 — Esteira Completa de Criação & Aquecimento 4G

Repositório desacoplado e higienizado com toda a camada de **Infraestrutura 4G USB (ADB + Every Proxy `:8080` + Ponte IPv4 Pura `:8082`)**, **Criação Anti-QR Code (`Dual-GPU + X-Client-Data Único` em Zero-CDP)**, **Aquecimento do Perfil Mãe (`2–3 dias`)**, **Estruturação de até `10 Fan Pages/Conta` na mesma sessão e mesmo IP (`~5m ficha + 2m pausa offline mesmo-IP = 0 KB/s 4G` + Negativação dos `67 Países`)** e **Aquecimento Ideal de `7 Dias` em Inglês (`Post Cruzado MBS + Story Curto 2.2s + Agendamento em Massa + Collab`)**.

> 📊 **Mapa Visual Interativo dos Processos**: Abra [`docs/ESTEIRA_CRIACAO_E_AQUECIMENTO_4G.html`](./docs/ESTEIRA_CRIACAO_E_AQUECIMENTO_4G.html) diretamente no navegador.

---

## 1. Fluxo Completo da Esteira (Padrão Ideal)

1. **Isolamento Absoluto 4G (`1 Conta = 1 IP Exclusivo`)**:
   - Antes de abrir cada conta, gira o Modo Avião via ADB (`adb_rotator.js`) e valida no `seen4gIpsInRun` que o IP CGNAT nunca foi usado por outra conta do lote.
   - Faz **100% da conta na mesma sessão e mesmo IP** e fecha o navegador antes de girar o 4G para a próxima conta.
2. **Fase 1 — Criação da Conta Mãe (`Gmail Principal Zero-CDP` + `Reserva Outlook` + `2FA`)**:
   - Alternância física Dual-GPU (`D3D11/D3D12`) + `X-Client-Data` exclusivo por perfil no `CloakBrowser C++` em modo `Zero-CDP` (`gmail_creator.js`).
   - Navegação prévia em portais com Meta Pixel (`meta_pixel_warmer.js`) para plantar `_fbp` legítimo no mesmo IP 4G + ativação imediata de **2FA TOTP**.
   - Suporte de reserva via `Outlook + 4G` caso o saldo de SMS se esgote.
3. **Fase 2 — Aquecimento do Perfil Mãe (`2 a 3 Dias` • `VIDEOS_AQUECIMENTO_PERFIL_PTBR`)**:
   - Ativação do **Modo Profissional**, assinatura de **10–15 Newsletters** (`newsletter_warmer.js`), interesses/amigos e **9 Reels curtos** (3/dia em `profile_reels_warmer.js`, idioma livre) para destravar o formulário completo de 3 campos (com Bio) e permitir 10+ páginas sem recusa.
4. **Fase 3 — Criação de até `10 Páginas` na Mesma Conta e Mesmo IP**:
   - **`~5 minutos` estruturando** cada página (Endereço comercial EUA + Telefone EUA variando os 2 últimos dígitos + `@gmail.com` sintático + `Sempre aberto` + rodízio de 20 fotos/8 capas + restrição **Idade `24+`** + **Negativação Oficial dos 67 Países**: Brasil #1 + 55 da África + 11 da Ásia/Oceania de baixo CPM -> entrega automática em EUA #1, UK, AU, CA e Holanda).
   - **`2 minutos` de intervalo entre páginas da mesma conta** estacionando a aba em `about:blank` com `offline: true` via CDP (**`0,00 KB/s` de consumo 4G mantendo 100% o mesmo IP**).
5. **Fase 4 — Aquecimento Ideal de `7 Dias` Já no Nicho em Inglês (`VIDEOS_AQUECIMENTO_PAGINAS_EN`)**:
   - **Zero espera de 24h pós-criação**: terminou de criar as páginas da conta, já publica na mesma sessão e mesmo IP usando vídeos curtos (`8–20s`) de Receitas Saudáveis/Cozinha em Inglês (`VIDEOS_AQUECIMENTO_PAGINAS_EN`).
   - **1º Story Curto de Duplo Sentido (`2.2s`)** (espera 100% do preview carregar; repetível todo dia após expirar as 24h).
   - **Post Cruzado Multi-Páginas (`?ref=biz_web_home_post_to_multiple_pages`)**: **1 único upload** aquece todas as 10 páginas irmãs da conta simultaneamente, com blindagem Anti-Hash (`hflip` + saturação `+4–6%` + vinheta + crop `2–4%` 1080p) e descrição rica em palavras-chave em Inglês (**Zero CTA e Zero Link escrito**).
   - **Agendamento em Massa MBS (`Miniatura -> Programação em grupo`)**: `2/dia (12h)` ou `3/dia (4h)` + teto `<= 5 reposts/mês` com `>= 5 dias` de intervalo.
   - **Collab (até 5 páginas) + Auto-Aceite de notificações** (`acceptPendingCollabInvitesOnPage`).

---

## 2. Comandos Rápidos

```bash
npm install
cp .env.example .env

# Saúde do túnel USB 4G (:8080 / :8082)
npm run infra:status

# Girar Modo Avião ADB e validar novo IP CGNAT
npm run infra:rotate

# Disparar a Esteira Completa 1-Clique (1 Conta = 1 IP 4G Exclusivo)
npm run warmup:conveyor
```
