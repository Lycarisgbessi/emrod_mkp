import React, { useEffect, useRef, useState } from 'react';
import { animate, motion, useInView } from 'motion/react';
import { useReducedMotion } from '../../hooks/useReducedMotion';

interface RevealProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}

/** Scroll-triggered reveal powered by motion (whileInView, once). */
export const Reveal: React.FC<RevealProps> = ({
  children,
  className = '',
  delay = 0,
  y = 24,
}) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const reduced = useReducedMotion();
  const inView = useInView(ref, { once: true, margin: '0px 0px -10% 0px' });
  const revealed = inView || reduced;

  return (
    <div ref={ref} className={className}>
      <motion.div
        initial={reduced ? false : { opacity: 0, y }}
        animate={revealed ? { opacity: 1, y: 0 } : { opacity: 0, y }}
        transition={{ duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] }}
      >
        {children}
      </motion.div>
    </div>
  );
};

export const AnimatedCounter: React.FC<{
  value: number;
  suffix?: string;
  formatter?: (n: number) => string;
  className?: string;
}> = ({ value, suffix = '', formatter, className = '' }) => {
  const [display, setDisplay] = useState(value);
  const reduced = useReducedMotion();
  const prevRef = useRef(0);

  useEffect(() => {
    if (reduced) {
      setDisplay(value);
      prevRef.current = value;
      return;
    }
    const controls = animate(prevRef.current, value, {
      duration: 0.45,
      ease: 'easeOut',
      onUpdate: (v) => setDisplay(Math.round(v)),
      onComplete: () => {
        prevRef.current = value;
      },
    });
    return () => {
      controls.stop();
    };
  }, [value, reduced]);

  const text = formatter ? formatter(display) : `${display}${suffix}`;
  return <span className={`tabular-nums ${className}`}>{text}</span>;
};
