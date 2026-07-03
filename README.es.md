# Bot de Opciones Binarias — Sistema de Trading con IA Híbrida

Un sistema de trading educativo y auto-hospedado para opciones binarias de IQ Option que combina
**machine learning tradicional** con **IA generativa (LLM)**, un gestor de riesgo en vivo y un
dashboard en tiempo real hecho en Next.js.

📄 *English version: [README.md](README.md)*

> ### ⚠️ Leé esto primero — aviso honesto
>
> Este es un **proyecto de investigación y educativo**, no una máquina de hacer dinero, y no es
> asesoramiento financiero.
>
> - **Las opciones binarias son un instrumento de esperanza matemática negativa.** Con un payout de
>   ~80% necesitás ganar **más del ~55.6%** de las operaciones solo para no perder. El bróker está
>   diseñado para tener la ventaja.
> - **Los activos OTC son sintéticos.** En fines de semana/OTC, el feed de precios lo genera el propio
>   bróker — estás apostando contra quien fabrica los números y ve tu posición.
> - **El trading automático viola los Términos de Servicio de la mayoría de los brókers** (IQ Option
>   incluido) y puede hacer que te congelen la cuenta. Las medidas anti-detección de este proyecto
>   **reducen** las señales obvias; no **eliminan** ese riesgo.
> - **Los resultados de backtest son idealizados** (payout constante, muestras chicas propensas a
>   sobreajuste). Un win rate alto en backtest **no** predice ganancias reales.
>
> Usalo en una **cuenta PRACTICE (demo)** para aprender sobre arquitectura de sistemas de trading,
> agentes LLM y meta-labeling con ML. Operar con dinero real es bajo tu propio riesgo.
> Ver [Limitaciones honestas](#limitaciones-honestas).

---

## Qué es realmente

Un ejemplo bien estructurado de cómo combinar varias ideas en un solo loop de trading en vivo:

- Un **motor de estrategias** que backtestea 21 estrategias técnicas sobre muchos activos y las rankea.
- Una **capa de IA generativa** (agentes LLM) que *escribe y mejora* código de estrategias nuevas a
  partir de noticias de mercado + performance en vivo.
- Una **capa de ML tradicional** (meta-labeling con regresión logística) que aprende de tu historial
  *real* de operaciones qué combinaciones estrategia/activo/hora/confianza ganan de verdad, y ajusta
  la confianza de cada señal.
- Un **portfolio dinámico** que opera varios activos en simultáneo, repartiendo el capital por score.
- Un **gestor de riesgo** con advertencias suaves, un hard stop y jitter tipo-humano en las operaciones.
- Un **dashboard en tiempo real** (Next.js) con operaciones, equity, estrategias, agentes, noticias y consola.

Buena ingeniería y ventaja rentable son **cosas distintas** — este proyecto entrega lo primero de
forma honesta y no promete lo segundo.

## Características

| Área | Qué hace |
|------|----------|
| **Múltiples proveedores LLM** | DeepSeek (default), OpenAI/ChatGPT, Google Gemini, Anthropic Claude — intercambiables en la UI. |
| **Sistema multi-agente** | Noticias → Research → Backtest → Análisis → Optimizador, generando y podando estrategias en vivo. |
| **Scorer ML de señales** | Meta-labeling con regresión logística entrenado con tus operaciones cerradas (se activa a los 30+ trades). |
| **Portfolio dinámico** | Opera hasta N activos distintos por vela; capital repartido por score de backtest (no multiplicado). |
| **Gestión de riesgo** | Límites suaves de pérdida diaria / consecutiva, opción de interés compuesto, hard stop kill-switch. |
| **Anti-detección** | Timing de entrada aleatorio y jitter de ±3% en el tamaño para evitar patrones perfectamente periódicos. |
| **Descubrimiento de activos** | Consulta al bróker qué activos están realmente abiertos ahora mismo. |
| **Dashboard** | Operaciones, curva de equity, calendario de P&L, ranking de estrategias, flujo de agentes, noticias, consola. |

## Stack técnico

- **Backend:** Python 3.11, FastAPI, SQLAlchemy (SQLite), scikit-learn, pandas/numpy, httpx.
- **Frontend:** Next.js 14, React, TypeScript, Tailwind CSS, Recharts.
- **API del bróker:** [`iqoptionapi`](https://github.com/iqoptionapi/iqoptionapi).

## Requisitos

- **Python 3.11+**
- **Node.js 18+**
- **Git** (la API de IQ Option se instala desde GitHub)
- Una **cuenta de IQ Option** (usá una cuenta PRACTICE/demo)
- Opcional: una **API key de LLM** (DeepSeek por defecto) y una key de **NewsAPI**

> **Nota:** no corras las instalaciones desde una carpeta sincronizada en la nube (unidades virtuales
> de Google Drive / OneDrive). El alto volumen de archivos de `npm install` / `pip install` corrompe
> `node_modules` y `venv` en esos sistemas de archivos virtuales. Mantené el proyecto en un **disco local**.

## Instalación y ejecución

### Inicio rápido (ambos servidores)

```bash
python run.py
```

Crea el venv de Python, instala dependencias, corre `npm install` y arranca:

- Backend → http://localhost:8100
- Frontend → http://localhost:3010

### Manual (dos terminales)

```bash
# Terminal 1 — backend
cd backend
python -m venv venv
venv/Scripts/python -m pip install -r requirements.txt   # Windows
python -m uvicorn main:app --port 8100

# Terminal 2 — frontend
cd frontend
npm install
npm run dev        # http://localhost:3000
```

## Configuración

Las credenciales se pueden ingresar directo en el panel de configuración del dashboard, o vía
variables de entorno. Copiá `backend/.env.example` a `backend/.env`:

```env
IQ_EMAIL=tu_email@example.com
IQ_PASSWORD=tu_password
ACCOUNT_TYPE=PRACTICE            # PRACTICE o REAL

# Proveedor de IA: deepseek (default) | openai | gemini | anthropic
AI_PROVIDER=deepseek
AI_API_KEY=tu_key_del_proveedor
# Overrides opcionales — dejar vacío para usar los defaults del proveedor
AI_BASE_URL=
AI_MODEL=

NEWS_API_KEY=tu_key_de_newsapi   # opcional
```

> **Seguridad:** nunca subas credenciales reales. Mantené `.env` fuera del control de versiones y
> rotá cualquier key que haya sido commiteada o sincronizada a la nube alguna vez.

## Cómo funciona (un ciclo de trading)

1. **Conecta** a IQ Option y detecta qué activos configurados están realmente abiertos.
2. **Backtestea** todas las estrategias × activos sobre velas recientes; las rankea por un score
   compuesto (win rate, profit factor, drawdown, actividad).
3. **Selecciona un portfolio** de los mejores combos de activos distintos (3 por defecto) y reparte
   el capital por score.
4. Justo antes de cada cierre de vela, **genera señales**; el **scorer ML** mezcla la confianza de
   cada estrategia con su probabilidad histórica de ganar.
5. **Entra a las operaciones** con timing sub-segundo aleatorio y tamaño con jitter, dimensionado por
   el gestor de riesgo.
6. **Registra resultados**, reentrena el scorer ML y rota los combos que pierden en vivo.
7. En paralelo, los **agentes LLM** investigan noticias, escriben código de estrategias nuevas, lo
   backtestean e inyectan las ganadoras — podando las perdedoras.

## Limitaciones honestas

Esta sección existe a propósito. Si compartís o forkeás esto, mantenela.

- **La matemática está en contra.** Ganar de forma sostenida en binarias — especialmente OTC — es
  extremadamente difícil por diseño. Ninguna estrategia técnica tiene ventaja garantizada sobre un
  feed controlado por el bróker.
- **Riesgo de sobreajuste.** Las estrategias se eligen como "la mejor de muchas" sobre muestras chicas
  de velas, con umbrales progresivamente más laxos. Eso puede promover ruido que solo *parece* señal.
- **Backtest ≠ vivo.** El backtester **no tiene look-ahead bias** (verificado — las estrategias nunca
  ven la vela del resultado). Los empates exactos se liquidan como reembolso (no pérdida) y una banda
  opcional de `slippage` modela la latencia/spread de entrada. Igual sigue siendo idealizado: payout
  constante de 0.80 por defecto y un desfase de una vela entre backtest y vivo.
- **Riesgo de cuenta/TOS.** El trading automático rompe los términos del bróker. La anti-detección
  reduce señales obvias pero no garantiza que no te detecten o restrinjan.
- **ML con pocos datos.** Con solo decenas–cientos de operaciones, el modelo de meta-labeling es un
  empujón suave, no un oráculo.

**En resumen:** tratalo como una plataforma de aprendizaje de ingeniería de IA + trading. Corrélo en
una cuenta demo. No arriesgues dinero que no puedas permitirte perder.

## Estructura del proyecto

```
backend/
  main.py                 App FastAPI (REST + WebSocket)
  config/                 settings + catálogo de activos
  connection/             wrapper del cliente de IQ Option
  engine/                 motor de trading (portfolio, loop en vivo, rotación)
  strategies/             21 estrategias técnicas incluidas
  backtesting/            backtester walk-forward + ranking
  ml/                     scorer ML tradicional (meta-labeling)
  agents/                 proveedores LLM + orquestador multi-agente
  risk/                   gestor de riesgo + kill switch
  news/                   fetcher de NewsAPI
  database/               modelos SQLAlchemy + acceso SQLite
frontend/
  app/                    páginas Next.js
  components/             UI del dashboard (portfolio, trades, agentes, estrategias…)
  hooks/                  hooks de estado del bot + WebSocket
run.py                    lanzador de un comando para ambos servidores
```

## Contribuir

Issues y PRs bienvenidos — especialmente sobre realismo del backtest (modelado de spread/slippage,
manejo de empates), calidad de estrategias y reportes honestos. Por favor mantené los disclaimers.

## Licencia

Bajo la **GNU Affero General Public License v3.0 (AGPL-3.0)** — ver [LICENSE](LICENSE).

Es una licencia copyleft fuerte elegida a propósito: cualquiera que use, modifique o **corra una
versión modificada como servicio de red** debe publicar su código bajo los mismos términos y mantener
los disclaimers honestos. Existe para evitar que este proyecto sea repackageado en una estafa
closed-source de "ganancias garantizadas".

---

*Este proyecto es con fines educativos. No es asesoramiento financiero. Operar opciones binarias
conlleva un alto riesgo de perder tu capital. Los autores no aceptan responsabilidad por pérdidas
financieras ni por acciones que tome cualquier bróker sobre tu cuenta.*
