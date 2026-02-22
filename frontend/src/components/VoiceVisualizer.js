import { cn } from '@/lib/utils';

const states = {
  idle: { className: 'opacity-40', ringCount: 2 },
  listening: { className: 'animate-voice-pulse animate-voice-glow', ringCount: 3 },
  processing: { className: 'animate-voice-spin', ringCount: 2 },
  speaking: { className: 'animate-voice-glow', ringCount: 4 },
};

export default function VoiceVisualizer({ state = 'idle', size = 'lg' }) {
  const config = states[state] || states.idle;
  const sizeMap = { sm: 'w-24 h-24', md: 'w-36 h-36', lg: 'w-48 h-48', xl: 'w-64 h-64' };
  const orbSize = sizeMap[size] || sizeMap.lg;

  return (
    <div className="relative flex items-center justify-center" data-testid="voice-visualizer">
      {/* Rings */}
      {Array.from({ length: config.ringCount }).map((_, i) => (
        <div key={i}
          className={cn('absolute rounded-full border border-primary/20', state === 'listening' && 'animate-voice-pulse')}
          style={{
            width: `calc(100% + ${(i + 1) * 40}px)`,
            height: `calc(100% + ${(i + 1) * 40}px)`,
            animationDelay: `${i * 0.3}s`,
            opacity: 1 - (i * 0.25),
          }}
        />
      ))}

      {/* Core orb */}
      <div className={cn(
        orbSize,
        'rounded-full flex items-center justify-center relative z-10 transition-all duration-500',
        'bg-gradient-to-br from-primary/80 to-primary',
        config.className,
      )}>
        {state === 'speaking' ? (
          <div className="flex items-center gap-1">
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className="voice-wave-bar bg-primary-foreground/80"
                style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
          </div>
        ) : state === 'processing' ? (
          <div className="w-8 h-8 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-voice-spin" />
        ) : (
          <div className="w-3 h-3 rounded-full bg-primary-foreground/70" />
        )}
      </div>

      {/* State label */}
      <div className="absolute -bottom-8 text-xs font-medium text-muted-foreground uppercase tracking-widest" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
        {state === 'idle' ? 'Ready' : state === 'listening' ? 'Listening...' : state === 'processing' ? 'Thinking...' : 'Speaking...'}
      </div>
    </div>
  );
}
