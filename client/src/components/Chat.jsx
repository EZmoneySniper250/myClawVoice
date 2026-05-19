import { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const msgVariants = {
  initial: { opacity: 0, y: 8, scale: 0.97 },
  animate: { opacity: 1, y: 0,  scale: 1,    transition: { duration: 0.28 } },
};

export function Chat({ transcript, currentResponse }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript, currentResponse]);

  if (transcript.length === 0 && !currentResponse) return null;

  return (
    <div className="chat-panel">
      <AnimatePresence initial={false}>
        {transcript.map((msg, i) => (
          <motion.div
            key={i}
            className={`msg ${msg.role}`}
            variants={msgVariants}
            initial="initial"
            animate="animate"
          >
            <div className="msg-bubble">{msg.text}</div>
          </motion.div>
        ))}

        {currentResponse && (
          <motion.div
            key="streaming"
            className="msg october"
            variants={msgVariants}
            initial="initial"
            animate="animate"
          >
            <div className="msg-bubble streaming">{currentResponse}</div>
          </motion.div>
        )}
      </AnimatePresence>
      <div ref={bottomRef} />
    </div>
  );
}
