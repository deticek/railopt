import { apiRequest } from './api-client';

export async function checkApiHealth(): Promise<boolean> {
  const response = await apiRequest('/health');
  return response.ok;
}
