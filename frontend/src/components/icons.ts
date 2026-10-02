import {
  BookOpen,
  BrainCircuit,
  Building2,
  ClipboardCheck,
  ClipboardList,
  FileCheck,
  FilePlus,
  History,
  LayoutDashboard,
  LogOut,
  ShieldCheck,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import type { IconName } from '../content/types'

/**
 * Maps the icon names used in the content files to Lucide icons
 * (outlined, consistent stroke — as required by the brand guidelines).
 */
export const icons: Record<IconName, LucideIcon> = {
  governance: ShieldCheck,
  compliance: ClipboardCheck,
  intelligence: BrainCircuit,
  workflow: Workflow,
  regulatory: FileCheck,
  organization: Building2,
  traceability: History,
  dashboard: LayoutDashboard,
  requests: ClipboardList,
  sops: BookOpen,
  departments: Building2,
  employees: Users,
  signOut: LogOut,
  submitRequest: FilePlus,
}
