import { createApiExamService } from './api-exam-service';
import type { ExamService } from './exam-model';

export const isExamMock =
  import.meta.env.DEV && import.meta.env.VITE_USE_MOCK === 'true';
export const examService: ExamService = isExamMock
  ? (await import('./mock-exam-service')).createMockExamService()
  : createApiExamService();
