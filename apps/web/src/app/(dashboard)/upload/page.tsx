'use client';

import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api';
import type { Empresa, Upload as UploadType } from '@/lib/types';
import { UploadCloud, FileText, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

const statusConfig: Record<string, { label: string; color: string }> = {
  AGUARDANDO: { label: 'Aguardando', color: 'bg-gray-100 text-gray-700' },
  PROCESSANDO: { label: 'Processando', color: 'bg-blue-100 text-blue-700' },
  PROCESSADO: { label: 'Processado', color: 'bg-green-100 text-green-700' },
  ERRO: { label: 'Erro', color: 'bg-red-100 text-red-700' },
  VALIDADO: { label: 'Validado', color: 'bg-emerald-100 text-emerald-700' },
  EXPORTADO: { label: 'Exportado', color: 'bg-purple-100 text-purple-700' },
};

export default function UploadPage() {
  const { accessToken } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaId, setEmpresaId] = useState('');
  const [mesReferencia, setMesReferencia] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState('');
  const [recentUploads, setRecentUploads] = useState<UploadType[]>([]);
  const [dragging, setDragging] = useState(false);

  const fetchEmpresas = useCallback(async () => {
    if (!accessToken) return;
    try {
      const response = await api.get<Empresa[]>('/api/v1/empresas', accessToken);
      setEmpresas(response.data);
    } catch {
      // silently fail
    }
  }, [accessToken]);

  const fetchRecentUploads = useCallback(async () => {
    if (!accessToken) return;
    try {
      const response = await api.get<UploadType[]>(
        '/api/v1/uploads?limit=10&sort=createdAt:desc',
        accessToken,
      );
      setRecentUploads(response.data);
    } catch {
      // silently fail
    }
  }, [accessToken]);

  useEffect(() => {
    void fetchEmpresas();
    void fetchRecentUploads();
  }, [fetchEmpresas, fetchRecentUploads]);

  // Polling: atualiza a cada 5s enquanto houver uploads em processamento
  useEffect(() => {
    const hasProcessing = recentUploads.some(
      (u) => u.status === 'AGUARDANDO' || u.status === 'PROCESSANDO',
    );
    if (!hasProcessing) return;

    const interval = setInterval(() => {
      void fetchRecentUploads();
    }, 5000);

    return () => clearInterval(interval);
  }, [recentUploads, fetchRecentUploads]);

  const handleFileSelect = (file: File) => {
    if (file.type !== 'application/pdf') {
      setUploadError('Apenas arquivos PDF são aceitos.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setUploadError('Arquivo excede o tamanho máximo de 20MB.');
      return;
    }
    setSelectedFile(file);
    setUploadError('');
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = () => {
    setDragging(false);
  };

  const handleSubmit = async () => {
    if (!selectedFile || !empresaId || !mesReferencia || !accessToken) return;

    setUploading(true);
    setUploadError('');
    setUploadSuccess('');

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('empresaId', empresaId);
      formData.append('mesReferencia', mesReferencia);

      await api.upload<UploadType>('/api/v1/uploads', formData, accessToken);

      setUploadSuccess('Upload realizado com sucesso! O processamento foi iniciado.');
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      void fetchRecentUploads();
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : 'Erro ao fazer upload',
      );
    } finally {
      setUploading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'PROCESSADO':
      case 'VALIDADO':
      case 'EXPORTADO':
        return <CheckCircle2 size={16} className="text-green-600" />;
      case 'ERRO':
        return <AlertTriangle size={16} className="text-red-600" />;
      case 'PROCESSANDO':
        return <Clock size={16} className="text-blue-600 animate-pulse" />;
      default:
        return <Clock size={16} className="text-gray-400" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Upload Form */}
      <div className="rounded-xl bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">
          Enviar Cartões de Ponto
        </h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="empresa"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Empresa
            </label>
            <select
              id="empresa"
              value={empresaId}
              onChange={(e) => setEmpresaId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Selecione uma empresa</option>
              {empresas.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.razaoSocial}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="mesRef"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Mês de Referência
            </label>
            <input
              id="mesRef"
              type="month"
              value={mesReferencia}
              onChange={(e) => setMesReferencia(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Drop zone */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
          }}
          role="button"
          tabIndex={0}
          className={`
            mt-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8
            transition-colors
            ${
              dragging
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
            }
          `}
        >
          <UploadCloud
            size={40}
            className={dragging ? 'text-blue-500' : 'text-gray-400'}
          />
          <p className="mt-2 text-sm text-gray-600">
            Arraste um PDF aqui ou clique para selecionar
          </p>
          <p className="text-xs text-gray-400">Máximo 20MB</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileSelect(file);
            }}
            className="hidden"
          />
        </div>

        {selectedFile && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-blue-50 p-3">
            <FileText size={18} className="text-blue-600" />
            <span className="text-sm text-blue-700">{selectedFile.name}</span>
            <span className="text-xs text-blue-500">
              ({(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)
            </span>
          </div>
        )}

        {uploadError && (
          <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {uploadError}
          </div>
        )}

        {uploadSuccess && (
          <div className="mt-3 rounded-lg bg-green-50 p-3 text-sm text-green-700">
            {uploadSuccess}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={!selectedFile || !empresaId || !mesReferencia || uploading}
          className="mt-4 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {uploading ? 'Enviando...' : 'Enviar'}
        </button>
      </div>

      {/* Recent Uploads */}
      <div className="rounded-xl bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-lg font-semibold text-gray-900">
          Uploads Recentes
        </h3>

        {recentUploads.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum upload encontrado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left">
                  <th className="pb-3 font-medium text-gray-500">Arquivo</th>
                  <th className="pb-3 font-medium text-gray-500">Empresa</th>
                  <th className="pb-3 font-medium text-gray-500">Mês</th>
                  <th className="pb-3 font-medium text-gray-500">Status</th>
                  <th className="pb-3 font-medium text-gray-500">Data</th>
                </tr>
              </thead>
              <tbody>
                {recentUploads.map((upload) => {
                  const status = statusConfig[upload.status] ?? {
                    label: upload.status,
                    color: 'bg-gray-100 text-gray-700',
                  };
                  return (
                    <tr
                      key={upload.id}
                      className="border-b border-gray-100 hover:bg-gray-50"
                    >
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <FileText size={16} className="text-gray-400" />
                          {upload.nomeArquivo}
                        </div>
                      </td>
                      <td className="py-3">
                        {upload.empresa?.razaoSocial ?? '-'}
                      </td>
                      <td className="py-3">{upload.mesReferencia}</td>
                      <td className="py-3">
                        <div className="flex items-center gap-1.5">
                          {getStatusIcon(upload.status)}
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.color}`}
                          >
                            {status.label}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 text-gray-500">
                        {new Date(upload.createdAt).toLocaleDateString('pt-BR')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
