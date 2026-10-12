import { LiveDashboard } from '../components/LiveDashboard'
import { runSsh } from '../server/ssh.functions'
import { createFileRoute } from '@tanstack/react-router'
import { FormEvent, useState } from 'react'
import { Clock3, Command, KeyRound, LockKeyhole, Network, RefreshCw, Server, ShieldCheck, UserRoundCog, Zap } from 'lucide-react'

export const Route = createFileRoute('/')({ component: ServerManager })

type ConnectionState = 'idle' | 'connecting' | 'connected'
function ServerManager() {
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle')
  const [host, setHost] = useState('192.168.1.131')
  const [port, setPort] = useState('22')
  const [username, setUsername] = useState('vboxuser')
  const [password, setPassword] = useState('')

  const [liveOutput, setLiveOutput] = useState('')
  const [connectionError, setConnectionError] = useState('')

  const connect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setConnectionState('connecting')
    setConnectionError('')
    try {
      const result = await runSsh({ data: { host: host.trim(), port, password, username: username.trim(), operation: 'overview' } })
      if (!result.ok) throw new Error(result.output)
      setLiveOutput(result.output)
      setConnectionState('connected')
    } catch (error) {
      setPassword('')
      setConnectionError(error instanceof Error ? error.message : 'Connection failed.')
      setConnectionState('idle')
    }
  }

  if (connectionState === 'connected') return <LiveDashboard coordinates={{ host: host.trim(), port, password, username: username.trim() }} initialOutput={liveOutput} disconnect={() => { setPassword(''); setConnectionState('idle') }} />

  return (
    <ConnectionScreen
      password={password}
      setPassword={setPassword}
      connectionError={connectionError}
      connectionState={connectionState}
      host={host}
      port={port}
      username={username}
      setHost={setHost}
      setPort={setPort}
      setUsername={setUsername}
      connect={connect}
    />
  )
}

function Brand() {
  return (
    <div className="brand-lockup">
      <div className="brand-mark"><Command size={19} strokeWidth={2.6} /></div>
      <div>
        <strong>Northstar</strong>
        <span>Ubuntu control</span>
      </div>
    </div>
  )
}

function ConnectionScreen({
  password, setPassword, connectionError,
  connectionState,
  host,
  port,
  username,
  setHost,
  setPort,
  setUsername,
  connect,
}: {
  password: string
  setPassword: (value: string) => void
  connectionError: string
  connectionState: ConnectionState
  host: string
  port: string
  username: string
  setHost: (value: string) => void
  setPort: (value: string) => void
  setUsername: (value: string) => void
  connect: (event: FormEvent<HTMLFormElement>) => void
}) {
  const isConnecting = connectionState === 'connecting'

  return (
    <main className="connection-shell">
      <div className="grid-texture" />
      <header className="connection-header">
        <Brand />
        <div className="secure-label"><LockKeyhole size={14} /> Local SSH gateway</div>
      </header>

      <section className="connection-layout">
        <div className="connection-intro">
          <div className="eyebrow"><span /> Remote operations console</div>
          <h1>Your server,<br /><em>within reach.</em></h1>
          <p>Connect to an Ubuntu host and manage its entire stack from one focused workspace.</p>
          <div className="trust-row">
            <div><ShieldCheck size={18} /><span><strong>SSH tunnel</strong>Encrypted session</span></div>
            <div><Clock3 size={18} /><span><strong>Password login</strong>Verified by Ubuntu</span></div>
          </div>
        </div>

        <form className="connection-card" onSubmit={connect}>
          <div className="card-index">01 / CONNECT</div>
          <div className="connection-card-title">
            <div className="server-glyph"><Server size={24} /></div>
            <div>
              <h2>Server coordinates</h2>
              <p>Enter the SSH endpoint for your Ubuntu server.</p>
            </div>
          </div>

          <label className="field-label" htmlFor="host">Host address</label>
          <div className="input-shell">
            <Network size={17} />
            <input disabled={isConnecting} id="host" value={host} onChange={(event) => setHost(event.target.value)} placeholder="server.example.com" required />
          </div>

          <div className="field-pair">
            <div>
              <label className="field-label" htmlFor="port">SSH port</label>
              <div className="input-shell compact"><span className="port-symbol">:</span><input disabled={isConnecting} id="port" value={port} onChange={(event) => setPort(event.target.value)} inputMode="numeric" required /></div>
            </div>
            <div>
              <label className="field-label" htmlFor="username">Username</label>
              <div className="input-shell compact"><UserRoundCog size={17} /><input disabled={isConnecting} id="username" value={username} onChange={(event) => setUsername(event.target.value)} required /></div>
            </div>
          </div>

          <label className="field-label" htmlFor="password">Ubuntu user password</label>
          <div className="input-shell"><KeyRound size={17} /><input id="password" type="password" autoComplete="current-password" required disabled={isConnecting} value={password} onChange={event => setPassword(event.target.value)} maxLength={1024} /></div>

          <button className="connect-button" type="submit" disabled={isConnecting}>
            {isConnecting ? <><RefreshCw className="spin" size={18} /> Negotiating secure session</> : <>Connect to server <Zap size={18} fill="currentColor" /></>}
          </button>
          {connectionError && <p className="live-error" role="alert">{connectionError}</p>}
          <p className="connection-hint">Your password is checked by Ubuntu over SSH. Verify the VM host key once from PowerShell before connecting. For NAT port forwarding, use 127.0.0.1 and your forwarded port (for example 2222).</p>
        </form>
      </section>
      <footer className="connection-footer"><span>Northstar Console v2.4</span><span>Designed for Ubuntu Server 22.04+</span></footer>
    </main>
  )
}
