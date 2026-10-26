// Real third-party marks, drawn from their published geometry. Used only to say what GlassVault is
// built on — never as GlassVault's own brand.

/// The Ethereum diamond (official 256×417 geometry, monochrome greys).
export function EthereumLogo({ size = 20, className = "" }) {
  return (
    <svg width={(size * 256) / 417} height={size} viewBox="0 0 256 417" className={className} aria-label="Ethereum" role="img">
      <polygon fill="#343434" points="127.9611 0 125.1661 9.5 125.1661 285.168 127.9611 287.958 255.9231 212.32" />
      <polygon fill="#8C8C8C" points="127.962 0 0 212.32 127.962 287.959 127.962 154.158" />
      <polygon fill="#3C3C3B" points="127.9611 312.1866 126.3861 314.1066 126.3861 412.3056 127.9611 416.9066 255.9991 236.5866" />
      <polygon fill="#8C8C8C" points="127.962 416.9052 127.962 312.1852 0 236.5852" />
      <polygon fill="#141414" points="127.9611 287.9577 255.9211 212.3207 127.9611 154.1587" />
      <polygon fill="#393939" points="0.0009 212.3208 127.9609 287.9578 127.9609 154.1588" />
    </svg>
  );
}

const STACK = [
  { name: "Ethereum (EVM)", note: "2 chains + bridge", logo: true },
  { name: "Solidity 0.8.28", note: "smart contracts" },
  { name: "OpenZeppelin 5", note: "audited building blocks" },
  { name: "EIP-712", note: "signed invoices & deliveries" },
  { name: "Sign-In with Ethereum", note: "EIP-4361" },
  { name: "MetaMask", note: "or a password wallet" },
];

/// "Built on" strip: the blockchain standards each proof rests on.
export function BuiltOn({ className = "" }) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <span className="mr-1 text-[12px] font-medium tracking-wide text-graphite uppercase">Built on</span>
      {STACK.map((s) => (
        <span
          key={s.name}
          title={s.note}
          className="group inline-flex h-8 items-center gap-2 rounded-full border border-hairline bg-white/80 px-3 text-[13px] text-ash transition-[border-color,color] hover:border-ash/40 hover:text-obsidian"
        >
          {s.logo && <EthereumLogo size={15} className="transition-transform duration-300 group-hover:rotate-y-180" />}
          {s.name}
        </span>
      ))}
    </div>
  );
}
