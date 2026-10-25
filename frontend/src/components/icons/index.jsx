import { motion } from "framer-motion";
import { draw } from "../../lib/motion";

// Base for every custom icon: 20px grid, 1.25 stroke, round caps, self-drawing paths.
// Pass `hover` variants via the parent's whileHover="hover" for micro-interactions.
function Icon({ size = 20, children, className = "", ...rest }) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      initial="hidden"
      animate="show"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      {children}
    </motion.svg>
  );
}

const P = (props) => <motion.path variants={draw} {...props} />;

export function VaultIcon(props) {
  return (
    <Icon {...props}>
      <P d="M3 4.5h14v11H3z" />
      <P d="M5.5 15.5v1.5M14.5 15.5v1.5" />
      <motion.g
        style={{ originX: "10px", originY: "10px" }}
        variants={{ hover: { rotate: 90, transition: { type: "spring", stiffness: 200, damping: 14 } } }}
      >
        <circle cx="10" cy="10" r="2.75" />
        <path d="M10 7.25v-1M10 13.75v-1M7.25 10h-1M13.75 10h-1" />
      </motion.g>
    </Icon>
  );
}

export function InvoiceIcon(props) {
  return (
    <Icon {...props}>
      <P d="M5 2.75h7.5L15 5.25V17.25l-1.75-1-1.75 1-1.75-1-1.75 1-1.25-1-1.75 1z" />
      <P d="M7.5 7.5h5M7.5 10h5M7.5 12.5h3" />
    </Icon>
  );
}

export function ShieldCheckIcon(props) {
  return (
    <Icon {...props}>
      <P d="M10 2.5l6 2.25v4.5c0 4-2.6 6.6-6 8.25-3.4-1.65-6-4.25-6-8.25v-4.5z" />
      <P d="M7.25 10l2 2 3.75-4" />
    </Icon>
  );
}

export function FingerprintIcon(props) {
  return (
    <Icon {...props}>
      <P d="M6 15.5c-.9-1.6-1.25-3.2-1.25-5A5.25 5.25 0 0 1 15 8.4" />
      <P d="M8 16.5c-.6-1.8-.75-3.8-.75-6a2.75 2.75 0 0 1 5.5 0c0 1.2.1 2.4.35 3.5" />
      <P d="M10 10.5c0 2.2.3 4.3 1 6.25" />
      <P d="M3 17L17 3" />
    </Icon>
  );
}

export function SnowLockIcon(props) {
  return (
    <Icon {...props}>
      <P d="M5.5 9h9v8h-9z" />
      <P d="M7.25 9V6.75a2.75 2.75 0 0 1 5.5 0V9" />
      <P d="M10 11.5v3M8.7 12.25l2.6 1.5M11.3 12.25l-2.6 1.5" />
    </Icon>
  );
}

export function EyeIcon(props) {
  return (
    <Icon {...props}>
      <P d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z" />
      <motion.circle cx="10" cy="10" r="2.25" variants={{ hover: { scaleY: [1, 0.1, 1], transition: { duration: 0.35 } } }} />
    </Icon>
  );
}

export function DropletIcon(props) {
  return (
    <Icon {...props}>
      <P d="M10 2.75s-5 5.4-5 9a5 5 0 0 0 10 0c0-3.6-5-9-5-9z" />
      <P d="M7.75 12.25a2.25 2.25 0 0 0 2.25 2.25" />
    </Icon>
  );
}

export function WalletIcon(props) {
  return (
    <Icon {...props}>
      <P d="M3 6.25h12.75a1.25 1.25 0 0 1 1.25 1.25v8.25a1.25 1.25 0 0 1-1.25 1.25H4.25A1.25 1.25 0 0 1 3 15.75z" />
      <P d="M3 6.25V5a1.75 1.75 0 0 1 1.75-1.75H13.5v3" />
      <circle cx="13.75" cy="11.5" r=".9" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function SlidersIcon(props) {
  return (
    <Icon {...props}>
      <P d="M5 3v14M10 3v14M15 3v14" />
      <motion.circle cx="5" cy="7" r="1.6" fill="var(--color-white)" variants={{ hover: { cy: 12 } }} />
      <motion.circle cx="10" cy="13" r="1.6" fill="var(--color-white)" variants={{ hover: { cy: 6 } }} />
      <motion.circle cx="15" cy="9" r="1.6" fill="var(--color-white)" variants={{ hover: { cy: 14 } }} />
    </Icon>
  );
}

export function LogoMark({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <rect x="1" y="1" width="26" height="26" rx="9" fill="var(--color-obsidian)" />
      <path d="M8 9.5h12v9H8z" fill="none" stroke="var(--color-white)" strokeWidth="1.25" />
      <circle cx="14" cy="14" r="2.4" fill="var(--color-signal)" />
    </svg>
  );
}

export function CheckIcon(props) {
  return (
    <Icon {...props}>
      <P d="M4.5 10.5l3.5 3.5 7.5-8" />
    </Icon>
  );
}

export function CrossIcon(props) {
  return (
    <Icon {...props}>
      <P d="M5 5l10 10M15 5L5 15" />
    </Icon>
  );
}

export function HourglassIcon(props) {
  return (
    <Icon {...props}>
      <P d="M5.5 2.75h9M5.5 17.25h9" />
      <P d="M6.5 2.75c0 4 7 4.5 7 7.25s-7 3.25-7 7.25M13.5 2.75c0 4-7 4.5-7 7.25s7 3.25 7 7.25" />
    </Icon>
  );
}

export function CrossInCircleIcon(props) {
  return (
    <Icon {...props}>
      <P d="M10 2.75a7.25 7.25 0 1 1 0 14.5 7.25 7.25 0 0 1 0-14.5z" />
      <P d="M10 6.5v7M6.5 10h7" />
    </Icon>
  );
}

export function BookIcon(props) {
  return (
    <Icon {...props}>
      <P d="M10 5.5C8.5 4.25 6 3.75 3 4v11.25c3-.25 5.5.25 7 1.5 1.5-1.25 4-1.75 7-1.5V4c-3-.25-5.5.25-7 1.5z" />
      <P d="M10 5.5v11.25" />
    </Icon>
  );
}

export function QrIcon(props) {
  return (
    <Icon {...props}>
      <P d="M3 3h5v5H3zM12 3h5v5h-5zM3 12h5v5H3z" />
      <P d="M12 12h2v2M17 12v5h-5M14.5 14.5v2.5" />
    </Icon>
  );
}

export function BridgeIcon(props) {
  return (
    <Icon {...props}>
      <P d="M2 14.5h16M3.5 14.5V17M16.5 14.5V17" />
      <P d="M3.5 14.5C5 9 15 9 16.5 14.5" />
      <motion.circle r="1.3" fill="currentColor" stroke="none" cy="10.4" variants={{ hidden: { cx: 4 }, show: { cx: 4 }, hover: { cx: [4, 16, 4], transition: { duration: 1.2 } } }} />
    </Icon>
  );
}

export function ScaleIcon(props) {
  return (
    <Icon {...props}>
      <P d="M10 3v14M6 17h8M3.5 6h13" />
      <P d="M3.5 6L1.75 11h3.5zM16.5 6l-1.75 5h3.5z" />
    </Icon>
  );
}

export function UploadIcon(props) {
  return (
    <Icon {...props}>
      <P d="M10 13V3.5M6.25 7.25L10 3.5l3.75 3.75" />
      <P d="M3.5 12.5v3.25c0 .7.55 1.25 1.25 1.25h10.5c.7 0 1.25-.55 1.25-1.25V12.5" />
    </Icon>
  );
}

export function RefundIcon(props) {
  return (
    <Icon {...props}>
      <P d="M4 8.5A6.5 6.5 0 1 1 3.75 12" />
      <P d="M3.5 4.5v4h4" />
    </Icon>
  );
}

export function GavelIcon(props) {
  return (
    <Icon {...props}>
      <P d="M7.5 3.5l5 5M5.25 5.75l5 5M6.4 4.6l4.95 4.95" />
      <P d="M9.9 8.1l6.6 6.6a1.4 1.4 0 0 1-2 2L7.9 10.1" />
      <P d="M2.75 17.25h6.5" />
    </Icon>
  );
}

export function CrackIcon(props) {
  return (
    <Icon {...props}>
      <P d="M4 3h12v14H4z" />
      <P d="M10 3l-1.5 4 3 2-2.5 3.5 1.5 4.5" />
    </Icon>
  );
}

export function CategoryIcon({ category, ...props }) {
  if (category === "Medical") return <CrossInCircleIcon {...props} />;
  if (category === "Education") return <BookIcon {...props} />;
  return <DropletIcon {...props} />;
}
