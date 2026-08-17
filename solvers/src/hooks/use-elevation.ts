import { createContext, useContext } from 'react';
import type { Permission } from '../types/permissions';

export interface ElevationContextType {
    requireElevation: (permission: Permission, action: () => void) => void;
}

export const ElevationContext = createContext<ElevationContextType | undefined>(undefined);

export const useElevation = () => {
    const context = useContext(ElevationContext);
    if (!context) throw new Error('useElevation must be used within ElevationProvider');
    return context;
};
