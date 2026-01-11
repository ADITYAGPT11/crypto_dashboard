import React from "react";
import ThemeToggle from "../ThemeToggle/ThemeToggle";
import "./Header.scss";
import RealTimeClock from "../../common-components/RealTimeClock";


const Header: React.FC = () => {
  return (
    <div className="header">
      <div className="header-content">
        <h1 className="title">Multi Exchange Dashboard</h1>
        <div className="status-bar">
          <RealTimeClock />
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
};

export default Header;
