import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import { Role, type ApiResponse } from '@online-exam/shared';
import './app/styles/index.css';

const queryClient = new QueryClient();
function App() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const response = await fetch('/api/v1/health', {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('API unavailable');
      return response.json() as Promise<ApiResponse<{ status: string }>>;
    },
    retry: false,
  });
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-3xl font-bold">Online Examination</h1>
      <p className="mt-4">Khung ứng dụng thi trực tuyến.</p>
      <p className="mt-2">
        API:{' '}
        {health.isPending
          ? 'Đang kết nối'
          : health.isError
            ? 'Chưa kết nối'
            : health.data.data.status}
      </p>
      <p className="mt-2">Vai trò: {Role.options.join(', ')}</p>
    </main>
  );
}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
