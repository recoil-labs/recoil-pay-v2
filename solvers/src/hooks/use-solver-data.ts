import { useState, useEffect } from 'react';
import { SolverApiService } from '../services/solverApi';
import { useSolverWebSocket } from './use-solver-websocket';
import type {
  SolverIdentityDto,
  OrderTelemetryItem,
  SolverQuoteDto,
  ContractsByKindDto,
  VaultAsset
} from '../services/solverApi';

export function useIdentities() {
  const [data, setData] = useState<SolverIdentityDto[]>([]);
  useEffect(() => {
    SolverApiService.getIdentities().then(setData);
  }, []);
  return { data, setIdentities: setData };
}

export function useTelemetry() {
  const [data, setData] = useState<OrderTelemetryItem[]>([]);
  const { orderUpdates, messages, isConnected } = useSolverWebSocket();

  useEffect(() => {
    SolverApiService.getTelemetry().then(setData);
  }, []);

  useEffect(() => {
    if (orderUpdates.length > 0) {
      setData((prev) => {
        let newData = [...prev];
        orderUpdates.forEach(update => {
          const idx = newData.findIndex(o => o.id === update.id);
          if (idx >= 0) {
            newData[idx] = update;
          } else {
            newData.unshift(update);
          }
        });
        return newData;
      });
    }
  }, [orderUpdates]);

  return { data, setTelemetry: setData, messages, isConnected };
}

export function useQuotes() {
  const [data, setData] = useState<SolverQuoteDto[]>([]);
  useEffect(() => {
    SolverApiService.getQuotes().then(setData);
  }, []);
  return { data, setQuotes: setData };
}

export function useContracts() {
  const [data, setData] = useState<ContractsByKindDto | null>(null);
  useEffect(() => {
    SolverApiService.getSupportedContracts().then(setData);
  }, []);
  return { data, setContracts: setData };
}

export function useVaults(refreshTick?: number) {
  const [data, setData] = useState<VaultAsset[]>([]);
  useEffect(() => {
    SolverApiService.getVaultBalances().then(setData);
  }, [refreshTick]);
  return { data, setVaults: setData };
}
