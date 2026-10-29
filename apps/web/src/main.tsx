import React, { FormEvent, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BrowserRouter,
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from 'react-router-dom';
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRight,
  Wallet as WalletIcon,
  LayoutDashboard,
  Send,
  History as HistoryIcon,
  ShieldCheck,
  LogOut,
  Plus,
  Copy,
  Activity,
  Layers,
  ChevronRight,
} from 'lucide-react';
import { formatMoney, toMinor } from '@finledger/shared';
import {
  api,
  authenticate,
  currentUser,
  logout,
  pendingMoneyPost,
  ApiError,
  User,
  Wallet,
  Transfer,
  History,
} from './api';
import './styles.css';
const client = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) =>
        !(error instanceof ApiError && error.status < 500) && count < 1,
      staleTime: 10000,
    },
  },
});
function ErrorBox({ error }: { error: unknown }) {
  return error ? (
    <p className="error" role="alert">
      {error instanceof Error
        ? error.message
        : 'Something went wrong. Please try again.'}
    </p>
  ) : null;
}
function Brand() {
  return (
    <Link className="brand" to="/">
      <span className="brand-mark">
        <Layers size={22} />
      </span>
      finledger<span className="brand-dot">.</span>
    </Link>
  );
}
function Auth({ register = false }: { register?: boolean }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (data: Record<string, string>) =>
      authenticate(register ? 'register' : 'login', data),
    onSuccess: async () => {
      qc.clear();
      await qc.invalidateQueries({ queryKey: ['me'] });
      navigate('/');
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate(
      Object.fromEntries(new FormData(event.currentTarget)) as Record<
        string,
        string
      >,
    );
  }
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <Brand />
        <div>
          <span className="eyebrow">BUILT ON TRUST. BACKED BY A LEDGER.</span>
          <h1>
            A clearer view
            <br />
            of every move.
          </h1>
          <p>
            Explore a digital wallet where every transaction has a story — and
            every balance adds up.
          </p>
          <div className="auth-ledger">
            <ShieldCheck size={30} />
            <span>
              Double-entry accounting
              <br />
              <small>Consistency at the core.</small>
            </span>
          </div>
        </div>
        <span className="muted">
          An engineering portfolio · Virtual EGP only
        </span>
      </section>
      <main className="auth-form">
        <span className="pill">SIMULATION ENVIRONMENT</span>
        <h2>{register ? 'Start your ledger' : 'Welcome back'}</h2>
        <p className="muted">
          {register
            ? 'Create an account to explore your demo wallet.'
            : 'Sign in to your FinLedger workspace.'}
        </p>
        <form onSubmit={submit}>
          {register && (
            <label>
              Full name
              <input
                name="name"
                autoComplete="name"
                minLength={2}
                maxLength={80}
                required
              />
            </label>
          )}
          <label>
            Email address
            <input type="email" name="email" autoComplete="email" required />
          </label>
          <label>
            Password
            <input
              type="password"
              name="password"
              autoComplete={register ? 'new-password' : 'current-password'}
              minLength={12}
              maxLength={128}
              required
            />
          </label>
          <small className="muted">Use at least 12 characters.</small>
          <ErrorBox error={mutation.error} />
          <button className="primary" disabled={mutation.isPending}>
            {mutation.isPending
              ? 'Please wait…'
              : register
                ? 'Create account'
                : 'Sign in'}
            <ArrowRight size={18} />
          </button>
        </form>
        <p className="muted">
          {register ? 'Already have an account?' : 'New to FinLedger?'}{' '}
          <Link to={register ? '/login' : '/register'}>
            {register ? 'Sign in' : 'Create an account'}
          </Link>
        </p>
        <p className="fineprint">
          Educational simulation. No real deposits, payments, or bank
          connections.
        </p>
      </main>
    </div>
  );
}
function Layout() {
  const me = useQuery({ queryKey: ['me'], queryFn: currentUser });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const signout = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      qc.clear();
      navigate('/login');
    },
  });
  if (me.isPending)
    return <div className="loading">Opening your workspace…</div>;
  if (me.error instanceof ApiError && me.error.status === 401)
    return <Navigate to="/login" replace />;
  if (!me.data)
    return (
      <main className="content">
        <ErrorBox error={me.error} />
        <button onClick={() => me.refetch()}>Retry connection</button>
      </main>
    );
  const user = me.data;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <span className="nav-label">WORKSPACE</span>
        <nav>
          {[
            ['/', LayoutDashboard, 'Overview'],
            ['/wallet', WalletIcon, 'My wallet'],
            ['/send', Send, 'Send money'],
            ['/transactions', HistoryIcon, 'Transactions'],
            ['/profile', ShieldCheck, 'Profile & security'],
          ].map(([path, Icon, label]) => {
            const Symbol = Icon as typeof WalletIcon;
            return (
              <NavLink key={String(path)} to={String(path)} end>
                <Symbol size={19} />
                {String(label)}
              </NavLink>
            );
          })}
          {user.role === 'ADMIN' && (
            <NavLink to="/admin">
              <Activity size={19} />
              Administration
            </NavLink>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="simulation">
            <span className="status-dot" />
            Demo workspace<p>Virtual money. Real engineering.</p>
          </div>
          <div className="user">
            <span className="avatar">{user.name.slice(0, 1)}</span>
            <div>
              <strong>{user.name}</strong>
              <small>
                {user.role === 'ADMIN' ? 'Administrator' : 'Personal account'}
              </small>
            </div>
            <button
              aria-label="Sign out"
              className="icon-button"
              onClick={() => signout.mutate()}
              disabled={signout.isPending}
            >
              <LogOut size={18} />
            </button>
          </div>
          <ErrorBox error={signout.error} />
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <span>
            Personal workspace <ChevronRight size={14} />{' '}
            <strong>FinLedger</strong>
          </span>
          <span className="demo-tag">
            <span className="status-dot" />
            DEMO MODE
          </span>
        </header>
        <main className="content">
          <Routes>
            <Route path="/" element={<Dashboard user={user} />} />
            <Route path="/wallet" element={<WalletPage />} />
            <Route path="/send" element={<SendPage />} />
            <Route path="/transactions" element={<HistoryPage />} />
            <Route path="/transactions/:id" element={<Details />} />
            <Route path="/profile" element={<Profile user={user} />} />
            <Route
              path="/admin"
              element={
                user.role === 'ADMIN' ? <AdminPage /> : <Navigate to="/" />
              }
            />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
        <footer>
          FINLEDGER{' '}
          <span>Educational simulation · All amounts in virtual EGP</span>
          <ShieldCheck size={14} />
        </footer>
      </div>
    </div>
  );
}
function useWallet() {
  return useQuery({
    queryKey: ['wallet'],
    queryFn: () => api<Wallet>('/wallets/me'),
  });
}
function WalletGate({
  children,
}: {
  children: (wallet: Wallet) => React.ReactNode;
}) {
  const wallet = useWallet();
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: () => api('/wallets', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wallet'] }),
  });
  if (wallet.isPending) return <div className="skeleton">Loading wallet…</div>;
  if (wallet.error instanceof ApiError && wallet.error.status === 404)
    return (
      <section className="panel empty">
        <WalletIcon size={36} />
        <h2>Your first chapter starts here</h2>
        <p>
          Create a demo wallet to receive virtual funds and explore transfers.
        </p>
        <button
          className="primary"
          onClick={() => create.mutate()}
          disabled={create.isPending}
        >
          Create demo wallet <Plus size={18} />
        </button>
        <ErrorBox error={create.error} />
      </section>
    );
  if (!wallet.data) return <ErrorBox error={wallet.error} />;
  return children(wallet.data);
}
function Title({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="page-title">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}
function BalanceCard({ wallet }: { wallet: Wallet }) {
  return (
    <section className="balance-card">
      <div className="balance-top">
        <span>
          <WalletIcon size={18} />
          Total available balance
        </span>
        <span className="pill">EGP WALLET</span>
      </div>
      <div className="balance">
        {formatMoney(wallet.balance).replace(' EGP', '')}
        <span>EGP</span>
      </div>
      <p>
        <span className="status-dot" />
        {wallet.status === 'ACTIVE'
          ? 'Available for demo transfers'
          : 'Wallet frozen'}
      </p>
      <div className="balance-bottom">
        <span>VIRTUAL FUNDS ONLY</span>
        <Link to="/send">
          Send money <ArrowUpRight size={17} />
        </Link>
      </div>
    </section>
  );
}
function Funding({ wallet }: { wallet: Wallet }) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () =>
      pendingMoneyPost<Transfer>(
        '/demo/fund',
        { amount: '100000', currency: 'EGP' },
        wallet.id,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wallet'] });
      void qc.invalidateQueries({ queryKey: ['history'] });
    },
  });
  return (
    <section className="panel funding">
      <span className="tile-icon">
        <Plus size={20} />
      </span>
      <h3>A little room to explore</h3>
      <p>
        Add EGP 1,000 in virtual funds to your wallet. Up to five top-ups per
        day.
      </p>
      <button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending || wallet.status !== 'ACTIVE'}
      >
        {mutation.isPending ? 'Adding demo funds…' : 'Add demo funds'}
        <Plus size={17} />
      </button>
      <ErrorBox error={mutation.error} />
      {mutation.isSuccess && (
        <p className="success" role="status">
          Demo funds added to your ledger.
        </p>
      )}
    </section>
  );
}
function Dashboard({ user }: { user: User }) {
  return (
    <>
      <Title
        eyebrow="YOUR MONEY, IN FOCUS"
        title={`Welcome, ${user.name.split(' ')[0]}.`}
        description="Every movement accounted for. Everything in one place."
      />
      <WalletGate>
        {(wallet) => (
          <>
            <div className="overview-grid">
              <BalanceCard wallet={wallet} />
              <Funding wallet={wallet} />
            </div>
            <div className="trust-row">
              <span>
                <ShieldCheck />
                Ledger-backed balances
              </span>
              <span>
                <Layers />
                Atomic transfers
              </span>
              <span>
                <Activity />
                Traceable activity
              </span>
            </div>
            <section className="panel">
              <div className="section-title">
                <div>
                  <h2>Recent activity</h2>
                  <p>Your latest wallet movements.</p>
                </div>
                <Link to="/transactions">
                  View all <ArrowRight size={16} />
                </Link>
              </div>
              <HistoryTable wallet={wallet} compact />
            </section>
            <div className="lower-grid">
              <section className="panel guide">
                <span className="eyebrow">UNDER THE HOOD</span>
                <h3>Two entries. One trusted balance.</h3>
                <p>
                  Every transfer records an equal debit and credit in an
                  immutable journal. Open any transaction to follow its ledger
                  trail.
                </p>
                <Link to="/transactions">
                  Explore your ledger <ArrowRight size={16} />
                </Link>
              </section>
              <Notifications />
            </div>
          </>
        )}
      </WalletGate>
    </>
  );
}
function WalletPage() {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  return (
    <>
      <Title
        eyebrow="YOUR ACCOUNT"
        title="My wallet"
        description="One wallet. A complete record of every virtual pound."
      />
      <WalletGate>
        {(wallet) => (
          <>
            <div className="overview-grid">
              <BalanceCard wallet={wallet} />
              <Funding wallet={wallet} />
            </div>
            <section className="panel wallet-info">
              <h2>Wallet details</h2>
              <p>
                Share this wallet ID with another FinLedger user to receive a
                demo transfer.
              </p>
              <label>
                Wallet ID
                <div className="copy-row">
                  <code>{wallet.id}</code>
                  <button
                    aria-label="Copy wallet ID"
                    onClick={() =>
                      void Promise.resolve()
                        .then(() => navigator.clipboard.writeText(wallet.id))
                        .then(() => setCopied(true))
                        .catch(() =>
                          setCopyError(
                            'Could not copy. Select and copy the wallet ID manually.',
                          ),
                        )
                    }
                  >
                    <Copy size={16} />
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </label>
              {copyError && <p role="alert">{copyError}</p>}
              <p>
                Status: <span className="success">{wallet.status}</span> ·
                Currency: EGP · Personal wallet
              </p>
            </section>
          </>
        )}
      </WalletGate>
    </>
  );
}
function TransferForm({ wallet }: { wallet: Wallet }) {
  const qc = useQueryClient();
  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');
  const [validation, setValidation] = useState('');
  const mutation = useMutation({
    mutationFn: (body: {
      sourceId: string;
      destinationId: string;
      amount: string;
      currency: string;
    }) => {
      return pendingMoneyPost<Transfer>('/transfers', body, wallet.id);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wallet'] });
      void qc.invalidateQueries({ queryKey: ['history'] });
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    setValidation('');
    try {
      mutation.mutate({
        sourceId: wallet.id,
        destinationId: destination.trim(),
        amount: toMinor(amount),
        currency: 'EGP',
      });
    } catch (e) {
      setValidation((e as Error).message);
    }
  }
  return (
    <div className="send-grid">
      <section className="panel">
        <h2>Make a transfer</h2>
        <p>Send virtual EGP to another FinLedger wallet.</p>
        <form onSubmit={submit}>
          <label>
            Recipient wallet ID
            <input
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="Paste the recipient’s wallet UUID"
              required
              pattern="[0-9a-fA-F-]{36}"
            />
          </label>
          <label>
            Amount in EGP
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              required
            />
          </label>
          <div className="available">
            Available <strong>{formatMoney(wallet.balance)}</strong>
          </div>
          <ErrorBox
            error={validation ? new Error(validation) : mutation.error}
          />
          <button
            className="primary"
            disabled={mutation.isPending || wallet.status !== 'ACTIVE'}
          >
            {mutation.isPending ? 'Processing transfer…' : 'Send virtual money'}
            <ArrowUpRight size={18} />
          </button>
        </form>
        {mutation.data && (
          <div className="success-box" role="status">
            <ShieldCheck size={22} />
            <div>
              <strong>Transfer completed</strong>
              <p>{formatMoney(mutation.data.amount)} has been recorded.</p>
              <Link to={`/transactions/${mutation.data.id}`}>
                View transaction →
              </Link>
            </div>
          </div>
        )}
      </section>
      <aside className="panel transfer-note">
        <span className="tile-icon">
          <ShieldCheck />
        </span>
        <h3>Every detail matters.</h3>
        <p>
          Review the recipient ID before sending. Completed transfers are
          permanent in this simulation.
        </p>
        <hr />
        <p>
          Your transfer is recorded atomically with two balanced ledger
          postings.
        </p>
        <small>Only virtual funds move. No real payment is made.</small>
      </aside>
    </div>
  );
}
function SendPage() {
  return (
    <>
      <Title
        eyebrow="MOVE WITH CONFIDENCE"
        title="Send money"
        description="A simple transfer, with a complete audit trail."
      />
      <WalletGate>{(wallet) => <TransferForm wallet={wallet} />}</WalletGate>
    </>
  );
}
function HistoryTable({
  wallet,
  compact = false,
}: {
  wallet: Wallet;
  compact?: boolean;
}) {
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState('');
  const [order, setOrder] = useState('desc');
  const [from, setFrom] = useState('');
  const query = useQuery({
    queryKey: ['history', page, kind, order, from, compact],
    queryFn: () =>
      api<History>(
        `/wallets/me/transactions?page=${page}&limit=${compact ? 5 : 15}&order=${order}${kind ? `&kind=${kind}` : ''}${from ? `&from=${from}T00:00:00.000Z` : ''}`,
      ),
  });
  return (
    <>
      {!compact && (
        <div className="filters">
          <label>
            Type
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All transactions</option>
              <option value="TRANSFER">Transfers</option>
              <option value="DEMO_FUNDING">Demo funding</option>
            </select>
          </label>
          <label>
            Order
            <select
              value={order}
              onChange={(e) => {
                setOrder(e.target.value);
                setPage(1);
              }}
            >
              <option value="desc">Newest first</option>
              <option value="asc">Oldest first</option>
            </select>
          </label>
          <label>
            From date
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
            />
          </label>
        </div>
      )}
      <ErrorBox error={query.error} />
      {query.isPending ? (
        <div className="skeleton">Loading activity…</div>
      ) : query.data?.items.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Transaction</th>
                <th>Date</th>
                <th>Status</th>
                <th className="align-right">Amount</th>
                <th>
                  <span className="sr-only">Details</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {query.data.items.map((item) => {
                const incoming = item.destinationId === wallet.id;
                return (
                  <tr key={item.id}>
                    <td>
                      <div className="transaction-name">
                        <span
                          className={`transaction-icon ${incoming ? 'incoming' : ''}`}
                        >
                          {incoming ? (
                            <ArrowDownLeft size={18} />
                          ) : (
                            <ArrowUpRight size={18} />
                          )}
                        </span>
                        <div>
                          <strong>
                            {item.kind === 'DEMO_FUNDING'
                              ? 'Demo top-up'
                              : incoming
                                ? 'Money received'
                                : 'Money sent'}
                          </strong>
                          <small>{item.id.slice(0, 8)}…</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      {new Date(item.createdAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </td>
                    <td>
                      <span className="status-label">Completed</span>
                    </td>
                    <td
                      className={`align-right amount ${incoming ? 'success' : ''}`}
                    >
                      {incoming ? '+' : '−'}
                      {formatMoney(item.amount)}
                    </td>
                    <td>
                      <Link
                        aria-label={`View transaction ${item.id}`}
                        to={`/transactions/${item.id}`}
                      >
                        <ArrowUpRight size={18} />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        !query.error && (
          <div className="empty">
            <HistoryIcon size={30} />
            <h3>Your activity will appear here</h3>
            <p>Add demo funds or send your first transfer to get started.</p>
          </div>
        )
      )}
      {!compact && query.data && (
        <div className="pagination">
          <span>{query.data.total} transactions</span>
          <button disabled={page === 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span>Page {page}</span>
          <button
            disabled={page * 15 >= query.data.total}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      )}
    </>
  );
}
function HistoryPage() {
  return (
    <>
      <Title
        eyebrow="THE COMPLETE PICTURE"
        title="Transactions"
        description="An immutable record of your wallet activity."
      />
      <WalletGate>
        {(wallet) => (
          <section className="panel">
            <HistoryTable wallet={wallet} />
          </section>
        )}
      </WalletGate>
    </>
  );
}
function Details() {
  const { id } = useParams();
  const query = useQuery({
    queryKey: ['transfer', id],
    queryFn: () => api<Transfer>(`/transfers/${id}`),
  });
  return (
    <>
      <Link className="back-link" to="/transactions">
        ← All transactions
      </Link>
      <Title
        eyebrow="FOLLOW THE MONEY"
        title="Transaction details"
        description="From a single transfer to its balanced ledger postings."
      />
      <ErrorBox error={query.error} />
      {query.isPending ? (
        <div className="skeleton">Loading transaction…</div>
      ) : (
        query.data && (
          <section className="panel details">
            <span className="status-label">Completed</span>
            <h2>{formatMoney(query.data.amount)}</h2>
            <dl>
              {[
                ['Transaction ID', query.data.id],
                ['Type', query.data.kind],
                ['Source wallet', query.data.sourceId],
                ['Destination wallet', query.data.destinationId],
                [
                  'Recorded at',
                  new Date(query.data.createdAt).toLocaleString(),
                ],
                ['Journal ID', query.data.journal?.id],
              ].map(([label, value]) => (
                <React.Fragment key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </React.Fragment>
              ))}
            </dl>
            <h3>Double-entry journal</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Wallet</th>
                    <th>Entry</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.journal?.postings.map((posting) => (
                    <tr key={posting.id}>
                      <td>
                        <code>{posting.walletId}</code>
                      </td>
                      <td>{posting.side}</td>
                      <td>{formatMoney(posting.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="success">
              <ShieldCheck size={16} /> Equal debits and credits. Permanently
              recorded.
            </p>
          </section>
        )
      )}
    </>
  );
}
function Notifications() {
  const query = useQuery({
    queryKey: ['notifications'],
    queryFn: () =>
      api<{ id: string; message: string }[]>('/notifications?limit=3'),
    refetchInterval: 10000,
  });
  return (
    <section className="panel">
      <h3>Notification inbox</h3>
      <p>Delivery updates from the background worker.</p>
      <ErrorBox error={query.error} />
      {query.isPending ? (
        <small>Loading notifications…</small>
      ) : query.data?.length ? (
        query.data.map((n) => (
          <p className="notification" key={n.id}>
            {n.message}
          </p>
        ))
      ) : (
        <p className="muted">
          No notifications yet. New activity arrives here after processing.
        </p>
      )}
    </section>
  );
}
function Profile({ user }: { user: User }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const signout = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      qc.clear();
      navigate('/login');
    },
  });
  return (
    <>
      <Title
        eyebrow="YOUR WORKSPACE IDENTITY"
        title="Profile & security"
        description="Your account and session at a glance."
      />
      <section className="panel details">
        <h2>{user.name}</h2>
        <dl>
          <dt>Email</dt>
          <dd>{user.email}</dd>
          <dt>Role</dt>
          <dd>{user.role}</dd>
          <dt>Session security</dt>
          <dd>Short-lived access token · Rotating refresh cookie</dd>
        </dl>
        <p>
          Signing out revokes this session immediately. Access tokens stay in
          memory; refresh tokens use an HTTP-only cookie.
        </p>
        <p className="muted">
          Password reset and multi-factor authentication are planned for a
          future version.
        </p>
        <button onClick={() => signout.mutate()} disabled={signout.isPending}>
          Sign out of this session <LogOut size={16} />
        </button>
        <ErrorBox error={signout.error} />
      </section>
    </>
  );
}
function AdminPage() {
  const stats = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => api<Record<string, unknown>>('/admin/stats'),
  });
  const jobs = useQuery({
    queryKey: ['admin-jobs'],
    queryFn: () =>
      api<{ id: string; attempts: number; lastError: string }[]>(
        '/admin/jobs/failed',
      ),
  });
  const audits = useQuery({
    queryKey: ['admin-audit'],
    queryFn: () =>
      api<
        { id: string; action: string; resourceId: string; createdAt: string }[]
      >('/admin/audit'),
  });
  return (
    <>
      <Title
        eyebrow="SYSTEM OPERATIONS"
        title="Administration"
        description="A view of the simulator’s health and processing activity."
      />
      <ErrorBox error={stats.error || jobs.error || audits.error} />
      <div className="stat-grid">
        {['users', 'wallets', 'transfers', 'pendingEvents'].map((key) => (
          <section className="panel" key={key}>
            <small>{key.replace('pendingEvents', 'Pending events')}</small>
            <h2>
              {stats.isPending
                ? '…'
                : String(stats.data?.[key] ?? 'Unavailable')}
            </h2>
          </section>
        ))}
      </div>
      <section className="panel">
        <h2>Failed background jobs</h2>
        {jobs.isPending ? (
          <p>Loading background jobs…</p>
        ) : jobs.error ? (
          <p>Background jobs unavailable.</p>
        ) : jobs.data?.length ? (
          jobs.data.map((job) => (
            <p key={job.id}>
              <code>{job.id}</code> · {job.attempts} attempts · {job.lastError}
            </p>
          ))
        ) : (
          <p>No failed jobs reported.</p>
        )}
      </section>
      <section className="panel">
        <h2>Audit trail</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Action</th>
                <th>Resource</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {audits.data?.map((a) => (
                <tr key={a.id}>
                  <td>{a.action}</td>
                  <td>
                    <code>{a.resourceId}</code>
                  </td>
                  <td>{new Date(a.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Auth />} />
          <Route path="/register" element={<Auth register />} />
          <Route path="*" element={<Layout />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
