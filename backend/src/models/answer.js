module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Answer',
    {
      submittedAnswer: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
      },
      isCorrect: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
      },
      awardedPoints: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      buzzOrder: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM('submitted', 'judged'),
        allowNull: false,
        defaultValue: 'submitted',
      },
      submittedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'answers',
    },
  );
