import React from "react";
import type { ConnectionState } from "../../types/connection";
import "./ConnectionStatus.scss";

interface ConnectionStatusProps {
  statuses: Record<string, ConnectionState>;
}

const LABELS: Record<ConnectionState, string> = {
  connecting: "Connecting…",
  live: "Live",
  down: "Down",
};

const ConnectionStatus: React.FC<ConnectionStatusProps> = ({ statuses }) => {
  return (
    <div className="connection-status">
      {Object.entries(statuses).map(([exchange, state]) => (
        <span key={exchange} className={`conn-badge conn-${state}`}>
          <span className="conn-dot" />
          <span className="conn-exchange">{exchange}</span>
          <span className="conn-state">{LABELS[state]}</span>
        </span>
      ))}
    </div>
  );
};

export default ConnectionStatus;
